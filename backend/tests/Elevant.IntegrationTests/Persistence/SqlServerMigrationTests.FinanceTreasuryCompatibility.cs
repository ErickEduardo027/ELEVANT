using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task FinanceTreasuryCompatibilityCreditsShareOriginalInvoiceCeiling()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var fixture = await TreasuryReviewFixtureAsync(database.ConnectionString, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        { await using var scope = provider.CreateAsyncScope(); return await action(scope.ServiceProvider); }
        Task<FinanceTreasuryAdjustmentsData?> Limits() => Run(sp => sp.GetRequiredService<IFinanceTreasuryStore>().AdjustmentsAsync(FinanceAccount, fixture.Invoice, ct));
        var today = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var debit = await Run(sp => sp.GetRequiredService<IFinanceTreasuryStore>().IssueAdjustmentAsync(FinanceAccount,
            fixture.Invoice, new(Guid.NewGuid(), "0", today, "Synthetic debit", "Debit", [new(fixture.Line, 10, 1000)]), ct));
        Assert.True(debit.IsSuccess);
        var rejected = await Run(sp => sp.GetRequiredService<IFinanceInvoiceLedgerStore>().IssueCreditNoteAsync(FinanceAccount,
            fixture.Invoice, new(Guid.NewGuid(), 2000, "Exceeds original invoice"), ct));
        Assert.Equal(FinanceCatalogFailure.Conflict, rejected.Failure);
        var limits = (await Limits())!;
        var credit = await Run(sp => sp.GetRequiredService<IFinanceTreasuryStore>().IssueAdjustmentAsync(FinanceAccount,
            fixture.Invoice, new(Guid.NewGuid(), limits.Version, today, "Synthetic line correction", "Credit", [new(fixture.Line, 3, 300)]), ct));
        Assert.True(credit.IsSuccess);
        rejected = await Run(sp => sp.GetRequiredService<IFinanceInvoiceLedgerStore>().IssueCreditNoteAsync(FinanceAccount,
            fixture.Invoice, new(Guid.NewGuid(), 701, "Exceeds remaining correction limit"), ct));
        Assert.Equal(FinanceCatalogFailure.Conflict, rejected.Failure);
        var input = new IssueCreditNoteInput(Guid.NewGuid(), 700, "Remaining original correction");
        var legacy = await Run(sp => sp.GetRequiredService<IFinanceInvoiceLedgerStore>().IssueCreditNoteAsync(FinanceAccount, fixture.Invoice, input, ct));
        Assert.True(legacy.IsSuccess);
        Assert.Equal(legacy.Id, (await Run(sp => sp.GetRequiredService<IFinanceInvoiceLedgerStore>().IssueCreditNoteAsync(FinanceAccount, fixture.Invoice, input, ct))).Id);
        Assert.Equal(0, Assert.Single((await Limits())!.Lines).CreditAmountRemaining);

        // Both public writers must reserve the same ceiling while competing, despite a debit increasing the balance.
        var raceFixture = await TreasuryReviewFixtureAsync(database.ConnectionString, ct);
        Assert.True((await Run(sp => sp.GetRequiredService<IFinanceTreasuryStore>().IssueAdjustmentAsync(FinanceAccount,
            raceFixture.Invoice, new(Guid.NewGuid(), "0", today, "Race debit", "Debit", [new(raceFixture.Line, 10, 1000)]), ct))).IsSuccess);
        var raceLimits = (await Run(sp => sp.GetRequiredService<IFinanceTreasuryStore>().AdjustmentsAsync(FinanceAccount, raceFixture.Invoice, ct)))!;
        var oldWriter = Run(sp => sp.GetRequiredService<IFinanceInvoiceLedgerStore>().IssueCreditNoteAsync(FinanceAccount,
            raceFixture.Invoice, new(Guid.NewGuid(), 700, "Concurrent historical credit"), ct));
        var newWriter = Run(sp => sp.GetRequiredService<IFinanceTreasuryStore>().IssueAdjustmentAsync(FinanceAccount,
            raceFixture.Invoice, new(Guid.NewGuid(), raceLimits.Version, today, "Concurrent line credit", "Credit", [new(raceFixture.Line, 7, 700)]), ct));
        await Task.WhenAll(oldWriter, newWriter);
        Assert.Equal(1, new[] { (await oldWriter).IsSuccess, (await newWriter).IsSuccess }.Count(x => x));
        await using var verify = CreateContext(database.ConnectionString);
        var numericId = await verify.NonFiscalInvoices.Where(i => i.PublicId == raceFixture.Invoice).Select(i => i.Id).SingleAsync(ct);
        var legacyAmount = await verify.NonFiscalCreditNotes.Where(n => n.InvoiceId == numericId).SumAsync(n => (decimal?)n.Amount, ct) ?? 0;
        var lineAmount = await verify.Set<FinanceTreasuryAdjustmentNote>().Where(n => n.InvoiceId == numericId && n.Kind == FinanceTreasuryAdjustmentKind.Credit).SumAsync(n => (decimal?)n.Amount, ct) ?? 0;
        Assert.Equal(700, legacyAmount + lineAmount);
    }

    [Fact]
    public async Task FinanceTreasuryCompatibilityNotifiesOnlyTheAirlineOncePerCommittedMutation()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var fixture = await TreasuryReviewFixtureAsync(database.ConnectionString, ct);
        async Task<T> Run<T>(Func<IFinanceTreasuryStore, Task<T>> action)
        { await using var scope = provider.CreateAsyncScope(); return await action(scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>()); }
        await using var inspect = CreateContext(database.ConnectionString);
        var customerId = await inspect.Users.Where(u => u.PublicId == Guid.Parse("40000000-0000-7000-8000-000000000003")).Select(u => u.Id).SingleAsync(ct);
        async Task<int> Notices()
        {
            var messages = await inspect.OutboxMessages.AsNoTracking().Where(m => m.EventType == "account.changed.v1").ToArrayAsync(ct);
            var notices = messages.Select(AccountChangeOutboxWriter.Decode).Where(p => p.Resource == "airline_treasury").ToArray();
            Assert.All(notices, p => { Assert.Equal(customerId, p.RecipientAccountId); Assert.Equal(fixture.Airline, p.ResourceId); });
            return notices.Length;
        }
        var before = await Notices(); var today = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var input = new FinanceTreasuryReceiptInput(Guid.NewGuid(), fixture.Airline, fixture.Station, "USD", 1000,
            "QA-NOTIFY-" + Guid.NewGuid().ToString("N"), "Transfer", today, "Synthetic notification test");
        var created = await Run(s => s.RecordAsync(FinanceAccount, input, ct)); Assert.True(created.IsSuccess);
        Assert.Equal(before + 1, await Notices());
        Assert.True((await Run(s => s.RecordAsync(FinanceAccount, input, ct))).Replayed);
        Assert.Equal(before + 1, await Notices());
        var detail = (await Run(s => s.GetAsync(FinanceAccount, created.Id!.Value, ct)))!;
        Assert.True((await Run(s => s.ApplyAsync(FinanceAccount, detail.Id, new(Guid.NewGuid(), detail.Version, today,
            "Notify partial allocation", [new(fixture.Invoice, "0", 300)]), ct))).IsSuccess);
        Assert.Equal(before + 2, await Notices());
        detail = (await Run(s => s.GetAsync(FinanceAccount, detail.Id, ct)))!;
        var application = Assert.Single(detail.Movements);
        Assert.True((await Run(s => s.ReverseAsync(FinanceAccount, detail.Id, new(Guid.NewGuid(), detail.Version, today,
            "Notify reversal", application.Id), ct))).IsSuccess);
        Assert.Equal(before + 3, await Notices());
        // A stale or misaddressed hint must still be hidden by the feed's live tenant check.
        AccountChangeOutboxWriter.Add(inspect, customerId, null, "airline_treasury", Guid.NewGuid(), DateTimeOffset.UtcNow);
        await inspect.SaveChangesAsync(ct);
        await using var dispatch = provider.CreateAsyncScope();
        await dispatch.ServiceProvider.GetRequiredService<IAccountChangeDispatcherStore>().DispatchPendingAsync(100, ct);
        var page = await dispatch.ServiceProvider.GetRequiredService<IAccountChangeReadStore>()
            .ReadAsync(Guid.Parse("40000000-0000-7000-8000-000000000003"), 0, 100, ct);
        var visible = page!.Changes.Where(c => c.Resource == "airline_treasury").ToArray();
        Assert.Equal(3, visible.Length); Assert.All(visible, c => Assert.Equal(fixture.Airline, c.ResourceId));
    }

    private static async Task<(Guid Invoice, Guid Line, Guid Airline, Guid Station)> TreasuryReviewFixtureAsync(string connection, CancellationToken ct)
    {
        await using var db = CreateContext(connection);
        var airline = await db.Airlines.SingleAsync(a => a.IataCode == "ZZ", ct);
        var station = await db.Stations.SingleAsync(s => s.Code == "PUJ", ct);
        var account = await db.Users.SingleAsync(a => a.PublicId == FinanceAccount, ct);
        var now = DateTimeOffset.UtcNow; var today = Elevant.Application.Common.BusinessCalendar.Today(now);
        var pre = new Preinvoice { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id,
            CreatedByAccountId = account.Id, RequestId = Guid.NewGuid(), PayloadHash = new string('a',64), From = today, To = today,
            CurrencyCode = "USD", Total = 1000, Status = PreinvoiceStatus.Invoiced, CreatedAt = now, UpdatedAt = now };
        db.Add(pre); await db.SaveChangesAsync(ct);
        var invoice = new NonFiscalInvoice { PublicId = Guid.NewGuid(), PreinvoiceId = pre.Id, AirlineId = airline.Id, StationId = station.Id,
            IssuedByAccountId = account.Id, RequestId = Guid.NewGuid(), Number = "NF-"+Guid.NewGuid().ToString("N"), CurrencyCode = "USD", Total = 1000, CreatedAt = now, UpdatedAt = now };
        var line = new PreinvoiceLine { PublicId = Guid.NewGuid(), PreinvoiceId = pre.Id, LineNumber = 1, Kind = PreinvoiceLineKind.Adjustment,
            OperationCode = "QA", OperationDate = today, ServiceCode = "QA", ServiceName = "Synthetic review service", ExecutedQuantity = 10,
            BillingUnit = "unit", UnitPrice = 100, Amount = 1000, CurrencyCode = "USD", AdjustmentReason = "Synthetic fixture", CreatedAt = now, UpdatedAt = now };
        db.AddRange(invoice,line); await db.SaveChangesAsync(ct);
        var billed = new NonFiscalInvoiceLine { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, PreinvoiceLineId = line.Id, LineNumber = 1,
            Kind = line.Kind, OperationCode = "QA", OperationDate = today, ServiceCode = "QA", ServiceName = line.ServiceName,
            ExecutedQuantity = 10, BillingUnit = "unit", UnitPrice = 100, Amount = 1000, CurrencyCode = "USD", CreatedAt = now, UpdatedAt = now };
        db.Add(billed); await db.SaveChangesAsync(ct); return (invoice.PublicId, billed.PublicId, airline.PublicId, station.PublicId);
    }
}
