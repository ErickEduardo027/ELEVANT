using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task FinanceTreasuryPersistsPartialApplicationsReplaysAndLimitsRaces()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var airline = await setup.Airlines.FirstAsync(ct);
        var station = await setup.Stations.SingleAsync(s => s.Code == "PUJ", ct);
        var account = await setup.Users.SingleAsync(u => u.PublicId == FinanceAccount, ct);
        var now = DateTimeOffset.UtcNow;
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        async Task<NonFiscalInvoice> InvoiceAsync(string currency = "USD")
        {
            var pre = new Preinvoice { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id,
                CreatedByAccountId = account.Id, RequestId = Guid.NewGuid(), PayloadHash = new string('a', 64),
                From = today, To = today, CurrencyCode = currency, Total = 1000m, Status = PreinvoiceStatus.Invoiced,
                CreatedAt = now, UpdatedAt = now };
            setup.Preinvoices.Add(pre); await setup.SaveChangesAsync(ct);
            var id = Guid.NewGuid();
            var inv = new NonFiscalInvoice { PublicId = id, PreinvoiceId = pre.Id, AirlineId = airline.Id,
                StationId = station.Id, IssuedByAccountId = account.Id, RequestId = Guid.NewGuid(), Number = $"NF-{id:N}",
                CurrencyCode = currency, Total = 1000m, DueDate = today.AddDays(-31), CreatedAt = now, UpdatedAt = now };
            setup.NonFiscalInvoices.Add(inv); await setup.SaveChangesAsync(ct); return inv;
        }
        var invoice = await InvoiceAsync();
        var second = await InvoiceAsync();
        // An independent invoice exercises the legacy and new balance at the same time.
        async Task<T> RunAsync<T>(Func<IFinanceTreasuryStore, Task<T>> action)
        {
            await using var context = CreateContext(database.ConnectionString);
            return await action(new FinanceTreasuryStore(context, new TreasuryTestActors(station.PublicId), TimeProvider.System));
        }
        var create = new FinanceTreasuryReceiptInput(Guid.NewGuid(), airline.PublicId, station.PublicId, "USD", 1000m,
            "SYNTHETIC-TREASURY", "Transfer", today, "Advance receipt");
        var recordRace = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => RunAsync(s => s.RecordAsync(FinanceAccount, create, ct))));
        Assert.All(recordRace, r => Assert.True(r.IsSuccess));
        Assert.Single(recordRace, r => r.Replayed);
        var recorded = recordRace[0];
        var receiptId = recorded.Id!.Value;
        var receipt = (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!;
        var apply = new FinanceTreasuryApplyInput(Guid.NewGuid(), receipt.Version, today, "Partial application",
            [new(invoice.PublicId, "0", 300m)]);
        var applied = await RunAsync(s => s.ApplyAsync(FinanceAccount, receiptId, apply, ct));
        Assert.True(applied.IsSuccess);
        var repeat = await RunAsync(s => s.ApplyAsync(FinanceAccount, receiptId, apply, ct));
        Assert.True(repeat.Replayed);
        Assert.Equal(applied.Id, repeat.Id);
        var changed = await RunAsync(s => s.ApplyAsync(FinanceAccount, receiptId, apply with { Reason = "Changed reason" }, ct));
        Assert.Equal(FinanceTreasuryFailure.Conflict, changed.Failure);
        var statement = (await RunAsync(s => s.StatementAsync(FinanceAccount, today, station.PublicId, airline.PublicId, ct)))!;
        Assert.Equal(700m, Assert.Single(statement.Invoices, i => i.Id == invoice.PublicId).Balance);
        Assert.Equal(700m, (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!.Available);
        Assert.Equal(1, await setup.Set<FinanceTreasuryMovement>().CountAsync(m => m.InvoiceId == invoice.Id, ct));
        Assert.Equal(2, await setup.AuditEntries.CountAsync(a => a.Action.StartsWith("finance.treasury."), ct));
        receipt = (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!;
        var version = Assert.Single(statement.Invoices, i => i.Id == invoice.PublicId).Version;
        var race = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => RunAsync(s => s.ApplyAsync(FinanceAccount,
            receiptId, new(Guid.NewGuid(), receipt.Version, today, "Race application", [new(invoice.PublicId, version, 500m)]), ct))));
        Assert.Single(race, r => r.IsSuccess);
        Assert.Single(race, r => r.Failure == FinanceTreasuryFailure.Conflict);
        receipt = (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!;
        Assert.Equal(200m, receipt.Available);
        Assert.True((await RunAsync(s => s.ApplyAsync(FinanceAccount, receiptId, new(Guid.NewGuid(), receipt.Version,
            today, "Second invoice", [new(second.PublicId, "0", 100m)]), ct))).IsSuccess);
        receipt = (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!;
        var original = Assert.Single(receipt.Movements, m => m.InvoiceId == second.PublicId);
        Assert.True((await RunAsync(s => s.ReverseAsync(FinanceAccount, receiptId,
            new(Guid.NewGuid(), receipt.Version, today, "Wrong invoice", original.Id), ct))).IsSuccess);
        receipt = (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!;
        var refund = new FinanceTreasuryRefundInput(Guid.NewGuid(), receipt.Version, today, "Return unapplied cash", 100m, "REFUND-TEST");
        Assert.True((await RunAsync(s => s.RefundAsync(FinanceAccount, receiptId, refund, ct))).IsSuccess);
        Assert.True((await RunAsync(s => s.RefundAsync(FinanceAccount, receiptId, refund, ct))).Replayed);
        receipt = (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!;
        Assert.Equal(100m, receipt.Available);
        Assert.Equal(100m, receipt.Refunded);
        Assert.Null(await RunAsync(s => s.GetAsync(Guid.NewGuid(), receiptId, ct)));
        Assert.Null(await RunAsync(s => s.GetAsync(ContractsAccount, receiptId, ct)));
        var before = (await RunAsync(s => s.StatementAsync(FinanceAccount, today.AddDays(-1), station.PublicId, airline.PublicId, ct)))!;
        Assert.Empty(before.Invoices); Assert.Empty(before.Receipts);
        // Reject a whole batch atomically if any invoice belongs outside this receipt's scope.
        receipt = (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!;
        var bad = await RunAsync(s => s.ApplyAsync(FinanceAccount, receiptId, new(Guid.NewGuid(), receipt.Version,
            today, "Invalid batch", [new(second.PublicId, "0", 50m), new(Guid.NewGuid(), "0", 50m)]), ct));
        Assert.Equal(FinanceTreasuryFailure.NotFound, bad.Failure);
        Assert.Equal(100m, (await RunAsync(s => s.GetAsync(FinanceAccount, receiptId, ct)))!.Available);
        // A distinct receipt reversal is only available after cash has no active allocations or refunds.
        var reverseReceipt = await RunAsync(s => s.RecordAsync(FinanceAccount, create with { RequestId = Guid.NewGuid(), Reference = "REVERSE-RECEIPT" }, ct));
        var reversible = (await RunAsync(s => s.GetAsync(FinanceAccount, reverseReceipt.Id!.Value, ct)))!;
        var reversal = new FinanceTreasuryReverseInput(Guid.NewGuid(), reversible.Version, today, "Duplicate receipt");
        Assert.True((await RunAsync(s => s.ReverseAsync(FinanceAccount, reversible.Id, reversal, ct))).IsSuccess);
        Assert.True((await RunAsync(s => s.ReverseAsync(FinanceAccount, reversible.Id, reversal, ct))).Replayed);
        Assert.True((await RunAsync(s => s.GetAsync(FinanceAccount, reversible.Id, ct)))!.Reversed);
        Assert.Equal(0m, (await RunAsync(s => s.GetAsync(FinanceAccount, reversible.Id, ct)))!.Available);
        // Frozen FX: correcting the catalog never reprices an existing allocation or its reversal.
        setup.ExchangeRates.Add(new ExchangeRate { PublicId = Guid.NewGuid(), RateDate = today, FromCurrency = "USD", ToCurrency = "DOP",
            Rate = 60.5m, Source = "Synthetic test rate", RecordedByAccountId = account.Id, IsCurrent = true, CreatedAt = now, UpdatedAt = now });
        await setup.SaveChangesAsync(ct);
        var dopInvoice = await InvoiceAsync("DOP");
        var fxReceipt = await RunAsync(s => s.RecordAsync(FinanceAccount, create with { RequestId = Guid.NewGuid(), Reference = "FX-RECEIPT" }, ct));
        var fx = (await RunAsync(s => s.GetAsync(FinanceAccount, fxReceipt.Id!.Value, ct)))!;
        Assert.True((await RunAsync(s => s.ApplyAsync(FinanceAccount, fx.Id, new(Guid.NewGuid(), fx.Version, today,
            "Cross currency allocation", [new(dopInvoice.PublicId, "0", 10m)]), ct))).IsSuccess);
        fx = (await RunAsync(s => s.GetAsync(FinanceAccount, fx.Id, ct)))!;
        var fxMovement = Assert.Single(fx.Movements);
        Assert.Equal(60.5m, fxMovement.ExchangeRate); Assert.Equal(605m, fxMovement.InvoiceAmount);
        await setup.ExchangeRates.Where(e => e.RateDate == today && e.FromCurrency == "USD" && e.ToCurrency == "DOP")
            .ExecuteUpdateAsync(update => update.SetProperty(e => e.Rate, 61m), ct);
        Assert.True((await RunAsync(s => s.ReverseAsync(FinanceAccount, fx.Id, new(Guid.NewGuid(), fx.Version, today,
            "Reverse at original FX", fxMovement.Id), ct))).IsSuccess);
        fx = (await RunAsync(s => s.GetAsync(FinanceAccount, fx.Id, ct)))!;
        var fxReversal = Assert.Single(fx.Movements, m => m.Kind == "ApplicationReversal");
        Assert.Equal(60.5m, fxReversal.ExchangeRate); Assert.Equal(605m, fxReversal.InvoiceAmount);
        // Historical settlements coexist with treasury applications without creating synthetic legacy payment rows.
        var historical = await InvoiceAsync();
        setup.NonFiscalPayments.Add(new NonFiscalPayment { PublicId = Guid.NewGuid(), InvoiceId = historical.Id,
            RecordedByAccountId = account.Id, RequestId = Guid.NewGuid(), Reference = "SYNTHETIC-LEGACY", CurrencyCode = "USD",
            Amount = 100m, PaidOn = today, CreatedAt = now, UpdatedAt = now });
        setup.NonFiscalCreditNotes.Add(new NonFiscalCreditNote { PublicId = Guid.NewGuid(), InvoiceId = historical.Id,
            IssuedByAccountId = account.Id, RequestId = Guid.NewGuid(), Number = $"NC-{Guid.NewGuid():N}", CurrencyCode = "USD",
            Amount = 50m, Reason = "Historical synthetic credit", CreatedAt = now, UpdatedAt = now });
        await setup.SaveChangesAsync(ct);
        Assert.Equal(FinanceTreasuryFailure.Conflict, (await RunAsync(s => s.RecordAsync(FinanceAccount,
            create with { RequestId = Guid.NewGuid(), Reference = "SYNTHETIC-LEGACY" }, ct))).Failure);
        var historicalReceipt = await RunAsync(s => s.RecordAsync(FinanceAccount, create with { RequestId = Guid.NewGuid(), Reference = "LEGACY-RECEIPT" }, ct));
        var hr = (await RunAsync(s => s.GetAsync(FinanceAccount, historicalReceipt.Id!.Value, ct)))!;
        Assert.True((await RunAsync(s => s.ApplyAsync(FinanceAccount, hr.Id, new(Guid.NewGuid(), hr.Version, today,
            "Treasury alongside historical payment", [new(historical.PublicId, "0", 300m)]), ct))).IsSuccess);
        statement = (await RunAsync(s => s.StatementAsync(FinanceAccount, today, station.PublicId, airline.PublicId, ct)))!;
        Assert.Equal(550m, Assert.Single(statement.Invoices, i => i.Id == historical.PublicId).Balance);
        Assert.Equal(1, await setup.NonFiscalPayments.CountAsync(p => p.InvoiceId == historical.Id, ct));
        // Line credit and debit notes consume independent remaining quantities/amounts and never move cash.
        var preLine = new PreinvoiceLine { PublicId = Guid.NewGuid(), PreinvoiceId = historical.PreinvoiceId,
            LineNumber = 1, Kind = PreinvoiceLineKind.Adjustment, OperationCode = "QA", OperationDate = today,
            ServiceCode = "QA", ServiceName = "Synthetic billed line", ExecutedQuantity = 10m, BillingUnit = "unit",
            UnitPrice = 100m, Amount = 1000m, CurrencyCode = "USD", AdjustmentReason = "Synthetic fixture", CreatedAt = now, UpdatedAt = now };
        setup.PreinvoiceLines.Add(preLine); await setup.SaveChangesAsync(ct);
        var invoiceLine = new NonFiscalInvoiceLine { PublicId = Guid.NewGuid(), InvoiceId = historical.Id, PreinvoiceLineId = preLine.Id,
            LineNumber = 1, Kind = PreinvoiceLineKind.Adjustment, OperationCode = "QA", OperationDate = today, ServiceCode = "QA",
            ServiceName = "Synthetic billed line", ExecutedQuantity = 10m, BillingUnit = "unit", UnitPrice = 100m,
            Amount = 1000m, CurrencyCode = "USD", CreatedAt = now, UpdatedAt = now };
        setup.NonFiscalInvoiceLines.Add(invoiceLine); await setup.SaveChangesAsync(ct);
        var limits = (await RunAsync(s => s.AdjustmentsAsync(FinanceAccount, historical.PublicId, ct)))!;
        var creditInput = new FinanceTreasuryAdjustmentInput(Guid.NewGuid(), limits.Version, today, "Credit damaged service",
            "Credit", [new(invoiceLine.PublicId, 3m, 300m)]);
        var credit = await RunAsync(s => s.IssueAdjustmentAsync(FinanceAccount, historical.PublicId, creditInput, ct));
        Assert.True(credit.IsSuccess);
        Assert.True((await RunAsync(s => s.IssueAdjustmentAsync(FinanceAccount, historical.PublicId, creditInput, ct))).Replayed);
        limits = (await RunAsync(s => s.AdjustmentsAsync(FinanceAccount, historical.PublicId, ct)))!;
        Assert.Equal(7m, Assert.Single(limits.Lines).CreditQuantityRemaining);
        Assert.Equal(650m, Assert.Single(limits.Lines).CreditAmountRemaining);
        Assert.Equal(FinanceTreasuryFailure.Conflict, (await RunAsync(s => s.IssueAdjustmentAsync(FinanceAccount, historical.PublicId,
            creditInput with { RequestId = Guid.NewGuid(), ExpectedVersion = limits.Version, Lines = [new(invoiceLine.PublicId, 8m, 100m)] }, ct))).Failure);
        var creditRace = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => RunAsync(s => s.IssueAdjustmentAsync(FinanceAccount,
            historical.PublicId, new(Guid.NewGuid(), limits.Version, today, "Race credit remaining", "Credit", [new(invoiceLine.PublicId, 6m, 600m)]), ct))));
        Assert.Single(creditRace, r => r.IsSuccess);
        Assert.Single(creditRace, r => r.Failure == FinanceTreasuryFailure.Conflict);
        limits = (await RunAsync(s => s.AdjustmentsAsync(FinanceAccount, historical.PublicId, ct)))!;
        var debit = await RunAsync(s => s.IssueAdjustmentAsync(FinanceAccount, historical.PublicId,
            new(Guid.NewGuid(), limits.Version, today, "Separate debit adjustment", "Debit", [new(invoiceLine.PublicId, 1m, 100m)], credit.Id), ct));
        Assert.True(debit.IsSuccess);
        limits = (await RunAsync(s => s.AdjustmentsAsync(FinanceAccount, historical.PublicId, ct)))!;
        Assert.Equal(credit.Id, Assert.Single(limits.Notes, n => n.Kind == "Debit").RelatedNoteId);
        hr = (await RunAsync(s => s.GetAsync(FinanceAccount, historicalReceipt.Id!.Value, ct)))!;
        Assert.Equal(700m, hr.Available); Assert.Equal(0m, hr.Refunded);
        Assert.Equal(1, await setup.NonFiscalInvoices.CountAsync(i => i.Id == historical.Id, ct));
        Assert.True((await RunAsync(s => s.ApplyAsync(FinanceAccount, receiptId, apply, ct))).Replayed);
        // Two separate receipts must also serialize on the invoice, not only on the receipt token.
        var raceInvoice = await InvoiceAsync();
        var competitors = new List<FinanceTreasuryReceiptData>();
        for (var index = 0; index < 2; index++)
        {
            var created = await RunAsync(s => s.RecordAsync(FinanceAccount, create with { RequestId = Guid.NewGuid(), Reference = $"INVOICE-RACE-{index}" }, ct));
            competitors.Add((await RunAsync(s => s.GetAsync(FinanceAccount, created.Id!.Value, ct)))!);
        }
        var invoiceRace = await Task.WhenAll(competitors.Select(r => RunAsync(s => s.ApplyAsync(FinanceAccount, r.Id,
            new(Guid.NewGuid(), r.Version, today, "Competing receipts", [new(raceInvoice.PublicId, "0", 600m)]), ct))));
        Assert.Single(invoiceRace, r => r.IsSuccess);
        Assert.Single(invoiceRace, r => r.Failure == FinanceTreasuryFailure.Conflict);
        statement = (await RunAsync(s => s.StatementAsync(FinanceAccount, today, station.PublicId, airline.PublicId, ct)))!;
        Assert.Equal(400m, Assert.Single(statement.Invoices, i => i.Id == raceInvoice.PublicId).Balance);
        var legacyRaceInvoice = await InvoiceAsync();
        var contender = competitors.Single(r => !invoiceRace[competitors.IndexOf(r)].IsSuccess);
        var treasuryTask = RunAsync(s => s.ApplyAsync(FinanceAccount, contender.Id,
            new(Guid.NewGuid(), contender.Version, today, "Race historical entry", [new(legacyRaceInvoice.PublicId, "0", 600m)]), ct));
        async Task<Elevant.Application.Finance.RecordNonFiscalPaymentResult> LegacyPayAsync()
        {
            await using var context = CreateContext(database.ConnectionString);
            return await new EfNonFiscalPaymentStore(context, TimeProvider.System).RecordAsync(new(FinanceAccount,
                legacyRaceInvoice.PublicId, Guid.NewGuid(), "RACE-LEGACY-PAYMENT", 600m, PaymentMethod.Transfer, today), ct);
        }
        var legacyTask = LegacyPayAsync(); await Task.WhenAll(treasuryTask, legacyTask);
        var treasuryRaceResult = await treasuryTask; var legacyRaceResult = await legacyTask;
        Assert.Equal(1, (treasuryRaceResult.IsSuccess ? 1 : 0) + (legacyRaceResult.IsSuccess ? 1 : 0));
        statement = (await RunAsync(s => s.StatementAsync(FinanceAccount, today, station.PublicId, airline.PublicId, ct)))!;
        Assert.Equal(400m, Assert.Single(statement.Invoices, i => i.Id == legacyRaceInvoice.PublicId).Balance);
        // A purely monetary invoice line has no executed quantity to return.
        var monetaryInvoice = await InvoiceAsync();
        var monetarySource = new PreinvoiceLine { PublicId = Guid.NewGuid(), PreinvoiceId = monetaryInvoice.PreinvoiceId,
            LineNumber = 1, Kind = PreinvoiceLineKind.Adjustment, OperationCode = "QA", OperationDate = today, ServiceCode = "QA",
            ServiceName = "Monetary adjustment", ExecutedQuantity = 0m, BillingUnit = "unit", UnitPrice = 0m, Amount = 1000m,
            CurrencyCode = "USD", AdjustmentReason = "Synthetic monetary source", CreatedAt = now, UpdatedAt = now };
        setup.PreinvoiceLines.Add(monetarySource); await setup.SaveChangesAsync(ct);
        var monetaryLine = new NonFiscalInvoiceLine { PublicId = Guid.NewGuid(), InvoiceId = monetaryInvoice.Id,
            PreinvoiceLineId = monetarySource.Id, LineNumber = 1, Kind = PreinvoiceLineKind.Adjustment, OperationCode = "QA",
            OperationDate = today, ServiceCode = "QA", ServiceName = "Monetary adjustment", ExecutedQuantity = 0m,
            BillingUnit = "unit", UnitPrice = 0m, Amount = 1000m, CurrencyCode = "USD", CreatedAt = now, UpdatedAt = now };
        setup.NonFiscalInvoiceLines.Add(monetaryLine); await setup.SaveChangesAsync(ct);
        Assert.True((await RunAsync(s => s.IssueAdjustmentAsync(FinanceAccount, monetaryInvoice.PublicId,
            new(Guid.NewGuid(), "0", today, "Correct monetary charge", "Credit", [new(monetaryLine.PublicId, 0m, 100m)]), ct))).IsSuccess);
        var zeroLimits = (await RunAsync(s => s.AdjustmentsAsync(FinanceAccount, monetaryInvoice.PublicId, ct)))!;
        Assert.Equal(0m, Assert.Single(zeroLimits.Lines).CreditQuantityRemaining);
        Assert.Equal(900m, Assert.Single(zeroLimits.Lines).CreditAmountRemaining);
        Assert.True(await setup.OutboxMessages.AnyAsync(m => m.EventType == "account.changed.v1" && m.PayloadJson.Contains("finance_receipts"), ct));
    }

    private sealed class TreasuryTestActors(Guid stationId) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid id, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(id != FinanceAccount ? null : new ActorContext(id, "synthetic@test.invalid", "Synthetic Finance", [],
                [new(Guid.NewGuid(), Guid.NewGuid(), "QA", "QA", OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new(stationId, "PUJ")], new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance,
                    new HashSet<string>(["finance.receipts.read", "finance.receipts.manage", "finance.receipts.apply",
                        "finance.receipts.reverse", "finance.receipts.refund", "finance.adjustments.read", "finance.adjustments.issue"]))));
    }
}
