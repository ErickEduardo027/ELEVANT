using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 4, block D: suppliers, supplier invoices, supplier payments and employee expenses answer every refusal with
/// a stable code (4-N27) and correct mistakes as status changes and linked rows with their history, never deletes.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string PayablesCorrectionsMigration = "20261109064156_AddPayablesCorrections";

    private static FinancePayablesLineInput PayablesLine(decimal price = 1000m) => new("Synthetic service", 1, price, 0);

    /// <summary>
    /// The migration of phase 4, block D round-trips over a seeded database, and its downgrade stops while a payment
    /// reversal (52410), a removed receipt (52411), a voided invoice (52412) or a discarded expense (52413) exists.
    /// </summary>
    [Fact]
    public async Task PayablesCorrectionsMigrationRoundTripsAndKeepsItsHistory()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var context = CreateContext(database.ConnectionString);
        async Task<bool> TableAsync(string table) => await context.Database.SqlQuery<int>(
            $"SELECT COUNT(*) AS Value FROM sys.tables WHERE object_id = OBJECT_ID({table})").SingleAsync(ct) == 1;
        async Task<string?> ReferenceFilterAsync() => await context.Database.SqlQuery<string?>(
            $"SELECT filter_definition AS Value FROM sys.indexes WHERE name = N'IX_supplier_invoices_supplier_id_document_reference'").SingleAsync(ct);
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, PayablesCorrectionsMigration) - 1];
        Assert.True(await TableAsync("commercial.payable_payment_reversals"));
        Assert.Equal("([status]<>N'Voided')", await ReferenceFilterAsync());

        await context.GetService<IMigrator>().MigrateAsync(previous, ct);
        Assert.False(await TableAsync("commercial.payable_payment_reversals"));
        Assert.Null(await ReferenceFilterAsync());
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
        Assert.True(await TableAsync("commercial.payable_payment_reversals"));
        Assert.Equal("([status]<>N'Voided')", await ReferenceFilterAsync());

        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var station = await db.Stations.FirstAsync(ct);
        var supplier = (await store.SaveSupplierAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "QA-ROUND", "Synthetic round trip", null, null, true), ct)).Value!.Id;
        var paid = await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "ROUND-PAY", PayablesUsd, 10), ct);
        Assert.True(paid.IsSuccess, paid.Failure);
        var payment = await db.Set<FinancePayablesPayment>().AsNoTracking().SingleAsync(x => x.PublicId == paid.Value!.Id, ct);
        var finance = await db.Users.Where(x => x.PublicId == FinanceAccount).Select(x => x.Id).SingleAsync(ct);
        db.Add(new FinancePayablesReversal { PublicId = Guid.NewGuid(), PaymentId = payment.Id, Reason = "Pago registrado por error",
            ActorAccountId = finance, ReversedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync(ct);
        async Task DowngradeStopsAsync(int number)
        {
            context.ChangeTracker.Clear();
            var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
            Assert.Equal(number, failure.Number);
            Assert.True(await TableAsync("commercial.payable_payment_reversals"));
        }
        await DowngradeStopsAsync(52410);
        await db.Set<FinancePayablesReversal>().ExecuteDeleteAsync(ct);

        var created = await store.SaveExpenseAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "Round trip expense",
            PayablesDate, PayablesUsd, new(), [PayablesLine(10)]), ct);
        var claim = (await store.GetExpenseAsync(FinanceAccount, created.Value!.Id, ct)).Value!;
        Assert.True((await store.UploadAttachmentAsync(FinanceAccount, claim.Id, true, Guid.NewGuid(), claim.Version, "application/pdf",
            "%PDF-1.7 round trip"u8.ToArray(), ct)).IsSuccess);
        await db.Set<FinancePayablesAttachment>().ExecuteUpdateAsync(set => set.SetProperty(x => x.RemovedAt, DateTimeOffset.UtcNow)
            .SetProperty(x => x.RemovedByAccountId, finance), ct);
        await DowngradeStopsAsync(52411);
        await db.Set<FinancePayablesAttachment>().ExecuteUpdateAsync(set => set.SetProperty(x => x.RemovedAt, (DateTimeOffset?)null)
            .SetProperty(x => x.RemovedByAccountId, (long?)null), ct);

        var bill = await store.SaveInvoiceAsync(FinanceAccount, null, new(Guid.NewGuid(), supplier, station.PublicId, "ROUND-0001",
            PayablesDate, PayablesDate, PayablesUsd, new(), [PayablesLine(10)]), ct);
        Assert.True(bill.IsSuccess, bill.Failure);
        await db.Set<SupplierInvoice>().ExecuteUpdateAsync(set => set.SetProperty(x => x.Status, SupplierInvoiceStatus.Voided), ct);
        await DowngradeStopsAsync(52412);
        await db.Set<SupplierInvoice>().ExecuteUpdateAsync(set => set.SetProperty(x => x.Status, SupplierInvoiceStatus.Draft), ct);

        await db.Set<EmployeeExpenseClaim>().ExecuteUpdateAsync(set => set.SetProperty(x => x.Status, EmployeeExpenseStatus.Cancelled), ct);
        await DowngradeStopsAsync(52413);
        await db.Set<EmployeeExpenseClaim>().ExecuteUpdateAsync(set => set.SetProperty(x => x.Status, EmployeeExpenseStatus.Draft), ct);

        // Without that history the downgrade and the upgrade run again over the business rows.
        await context.GetService<IMigrator>().MigrateAsync(previous, ct);
        Assert.False(await TableAsync("commercial.payable_payment_reversals"));
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
        Assert.Equal(1, await db.Set<SupplierInvoice>().CountAsync(ct));
        Assert.Equal(1, await db.Set<FinancePayablesAttachment>().CountAsync(ct));
    }

    /// <summary>Grants Finance codes to a member account the test created (its template stays empty).</summary>
    private static async Task GrantPayablesAsync(ElevantDbContext db, Guid account, CancellationToken ct, params string[] codes)
    {
        var id = await db.Users.Where(u => u.PublicId == account).Select(u => u.Id).SingleAsync(ct);
        db.AccountPermissionGrants.AddRange(codes.Select(code => new Elevant.Domain.Entities.Identity.AccountPermissionGrant { AccountId = id, PermissionCode = code }));
        await db.SaveChangesAsync(ct);
    }

    /// <summary>The «Cuentas por pagar» report rows of the station at <paramref name="to"/>: reference → balance.</summary>
    private static async Task<IReadOnlyDictionary<string, decimal>> PayablesReportAsync(IServiceProvider services, Guid station, DateOnly to,
        CancellationToken ct)
    {
        var report = await services.GetRequiredService<Elevant.Application.Abstractions.Finance.IFinanceReportStore>().GetAsync(FinanceAccount,
            "payables", new(to.AddDays(-7), to, station, null, "USD"), ct);
        Assert.NotNull(report);
        var columns = report.Columns.ToList();
        var reference = columns.FindIndex(c => c.Key == "reference"); var balance = columns.FindIndex(c => c.Key == "balance");
        return report.Rows.ToDictionary(row => row[reference]!, row => decimal.Parse(row[balance]!, System.Globalization.CultureInfo.InvariantCulture));
    }

    /// <summary>
    /// 4-N03: a rejected invoice returns to Draft to be corrected and approved; a draft, a rejected or an approved invoice
    /// without active applications is voided with its reason and frees its reference, and the report at a cut-off keeps
    /// it only until its void. An approved invoice never returns to Draft and a submitted one is decided first.
    /// </summary>
    [Fact]
    public async Task SupplierInvoicesAreCorrectedAndVoidedWithTheirHistoryAndFreeTheirReference()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var approver = await AddPayablesExpenseActorAsync(db, "payables-approver", ct);
        var clerk = await AddPayablesExpenseActorAsync(db, "payables-clerk", ct, Department.Finance, DepartmentAssignmentKind.Member);
        await GrantPayablesAsync(db, clerk, ct, "finance.payables.read", "finance.payables.create", "finance.payables.update",
            "finance.payables.approve", "finance.payables.pay");
        var station = await db.Stations.FirstAsync(ct);
        var supplier = (await store.SaveSupplierAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "QA-FIX", "Synthetic corrections", null, null, true), ct)).Value!.Id;
        FinancePayablesSave Bill(string reference, decimal price = 1000m) => new(Guid.NewGuid(), supplier, station.PublicId, reference, PayablesDate,
            PayablesDate.AddDays(30), PayablesUsd, new(), [PayablesLine(price)]);
        async Task<FinancePayablesView> ViewAsync(Guid id) => (await store.GetInvoiceAsync(FinanceAccount, id, ct)).Value!;
        async Task<FinancePayablesResult<FinancePayablesMutation>> DecideAsync(Guid actor, Guid id, string decision, string? reason = null) =>
            await store.DecideInvoiceAsync(actor, id, new(Guid.NewGuid(), (await ViewAsync(id)).Version, decision, reason), ct);

        // Rejected, corrected (back to Draft, with its reason), edited, submitted again and approved by another person.
        var rejected = (await store.SaveInvoiceAsync(FinanceAccount, null, Bill("NCF-REJECT"), ct)).Value!.Id;
        Assert.True((await DecideAsync(FinanceAccount, rejected, "Submitted")).IsSuccess);
        Assert.True((await DecideAsync(approver, rejected, "Rejected", "Importe digitado con error")).IsSuccess);
        Assert.Equal("reason_required", (await DecideAsync(FinanceAccount, rejected, "Draft")).Failure);
        Assert.Equal("invalid_state", (await DecideAsync(FinanceAccount, rejected, "Approved")).Failure);
        Assert.True((await DecideAsync(FinanceAccount, rejected, "Draft", "Corregir el importe")).IsSuccess);
        var corrected = await store.SaveInvoiceAsync(FinanceAccount, rejected, Bill("NCF-REJECT", 1200m) with { ExpectedVersion = (await ViewAsync(rejected)).Version }, ct);
        Assert.True(corrected.IsSuccess, corrected.Failure);
        Assert.True((await DecideAsync(FinanceAccount, rejected, "Submitted")).IsSuccess);
        Assert.True((await DecideAsync(approver, rejected, "Approved")).IsSuccess);
        var approved = await ViewAsync(rejected);
        Assert.Equal(("Approved", 1200m, 1200m), (approved.Status, approved.Total, approved.Remaining));
        Assert.Equal(["Submission", "Finance", "Correction", "Submission", "Finance"], approved.Reviews.Select(r => r.Stage).ToArray());
        Assert.Equal("Corregir el importe", approved.Reviews[2].Reason);
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == rejected && x.Action == "finance.payable.reopened", ct));
        // An approved invoice never returns to Draft: it is voided and registered again.
        Assert.Equal("invalid_state", (await DecideAsync(FinanceAccount, rejected, "Draft", "Corregir otra vez")).Failure);

        // Voiding an approved invoice is a reversal; with an active application it keeps its balance history.
        Assert.Equal("forbidden", (await DecideAsync(clerk, rejected, "Voided", "Aprobada por error")).Failure);
        var paid = await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "FIX-PAY", PayablesUsd, 100), ct);
        var payment = (await store.GetPaymentAsync(FinanceAccount, paid.Value!.Id, ct)).Value!;
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, payment.Id, new(Guid.NewGuid(), payment.Version,
            [new(rejected, (await ViewAsync(rejected)).Version, 100, 1)]), ct)).IsSuccess);
        Assert.Equal("invoice_has_applications", (await DecideAsync(FinanceAccount, rejected, "Voided", "Aprobada por error")).Failure);

        // An approved invoice without applications is voided with its reason and frees its reference.
        var past = new PayablesSettlementClock(DateTimeOffset.UtcNow.AddDays(-3));
        var earlier = new Elevant.Persistence.Finance.FinancePayablesStore(db, scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Identity.IActorContextResolver>(), new PayablesObjects(), past);
        var earlierDay = Elevant.Application.Common.BusinessCalendar.Today(past.GetUtcNow());
        var wrongFx = new FinancePayablesFx("USD", 60m, "Synthetic approved FX", earlierDay);
        var voided = (await earlier.SaveInvoiceAsync(FinanceAccount, null, Bill("NCF-VOID") with { DocumentDate = earlierDay, DueDate = earlierDay, Fx = wrongFx }, ct)).Value!.Id;
        Assert.True((await earlier.DecideInvoiceAsync(FinanceAccount, voided, new(Guid.NewGuid(), (await ViewAsync(voided)).Version, "Submitted"), ct)).IsSuccess);
        Assert.True((await earlier.DecideInvoiceAsync(approver, voided, new(Guid.NewGuid(), (await ViewAsync(voided)).Version, "Approved"), ct)).IsSuccess);
        Assert.Equal("duplicate_reference", (await store.SaveInvoiceAsync(FinanceAccount, null, Bill(" ncf-void "), ct)).Failure);
        Assert.Equal("reason_required", (await DecideAsync(FinanceAccount, voided, "Voided", "Mal")).Failure);
        Assert.True((await DecideAsync(FinanceAccount, voided, "Voided", "Monto aprobado por error")).IsSuccess);
        var withdrawn = await ViewAsync(voided);
        Assert.Equal(("Voided", 0m, 0m), (withdrawn.Status, withdrawn.Paid, withdrawn.Remaining));
        Assert.Equal(("Void", "Voided", "Monto aprobado por error"), (withdrawn.Reviews[^1].Stage, withdrawn.Reviews[^1].Decision, withdrawn.Reviews[^1].Reason));
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == voided && x.Action == "finance.payable.voided", ct));
        Assert.Equal("invalid_state", (await DecideAsync(FinanceAccount, voided, "Draft", "Reabrir la anulada")).Failure);
        Assert.Equal("invalid_state", (await DecideAsync(FinanceAccount, voided, "Voided", "Anular dos veces")).Failure);
        var again = await store.SaveInvoiceAsync(FinanceAccount, null, Bill(" ncf-void "), ct);
        Assert.True(again.IsSuccess, again.Failure);
        Assert.Equal(2, await db.Set<SupplierInvoice>().CountAsync(x => x.DocumentReference == "NCF-VOID", ct));
        Assert.Contains((await store.ListInvoicesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, Status: "Voided"), ct)).Value!, x => x.Id == voided);
        Assert.DoesNotContain((await store.ListInvoicesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, OutstandingOnly: true), ct)).Value!, x => x.Id == voided);
        // The report at a cut-off before the void still owes it; from the void on it is gone.
        Assert.Equal(1000m, (await PayablesReportAsync(scope.ServiceProvider, station.PublicId, earlierDay, ct))["NCF-VOID"]);
        var today = await PayablesReportAsync(scope.ServiceProvider, station.PublicId, Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow), ct);
        Assert.False(today.ContainsKey("NCF-VOID"));
        Assert.Equal(1100m, today["NCF-REJECT"]);

        // A draft and a rejected invoice are voided with the edit code; a submitted one is decided first.
        var draft = (await store.SaveInvoiceAsync(clerk, null, Bill("NCF-DRAFT"), ct)).Value!.Id;
        Assert.True((await DecideAsync(clerk, draft, "Voided", "Borrador duplicado")).IsSuccess);
        var submitted = (await store.SaveInvoiceAsync(clerk, null, Bill("NCF-SUBMITTED"), ct)).Value!.Id;
        Assert.True((await DecideAsync(clerk, submitted, "Submitted")).IsSuccess);
        Assert.Equal("invalid_state", (await DecideAsync(FinanceAccount, submitted, "Voided", "Enviada por error")).Failure);
        Assert.True((await DecideAsync(approver, submitted, "Rejected", "Proveedor equivocado")).IsSuccess);
        Assert.True((await DecideAsync(clerk, submitted, "Voided", "Proveedor equivocado")).IsSuccess);
        Assert.Equal("Voided", (await ViewAsync(submitted)).Status);
    }

    /// <summary>
    /// 4-N04: an application to the wrong invoice is reversed and a payment recorded by mistake is voided once nothing of it
    /// remains applied, both as linked rows with their reason that the balances, the lists and the report at a cut-off stop
    /// counting from their instant on. The payment and its applications stay as they were.
    /// </summary>
    [Fact]
    public async Task SupplierPaymentApplicationsAreReversedAndPaymentsVoidedAsLinkedRows()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var approver = await AddPayablesExpenseActorAsync(db, "reversal-approver", ct);
        var clerk = await AddPayablesExpenseActorAsync(db, "reversal-clerk", ct, Department.Finance, DepartmentAssignmentKind.Member);
        await GrantPayablesAsync(db, clerk, ct, "finance.payables.read", "finance.payables.pay");
        var station = await db.Stations.FirstAsync(ct);
        var past = new PayablesSettlementClock(DateTimeOffset.UtcNow.AddDays(-3));
        var earlier = new Elevant.Persistence.Finance.FinancePayablesStore(db, scope.ServiceProvider.GetRequiredService<Elevant.Application.Abstractions.Identity.IActorContextResolver>(), new PayablesObjects(), past);
        var earlierDay = Elevant.Application.Common.BusinessCalendar.Today(past.GetUtcNow());
        var fx = new FinancePayablesFx("USD", 60m, "Synthetic approved FX", earlierDay);
        var supplier = (await store.SaveSupplierAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "QA-REV", "Synthetic reversals", null, null, true), ct)).Value!.Id;
        async Task<FinancePayablesView> ViewAsync(Guid id) => (await store.GetInvoiceAsync(FinanceAccount, id, ct)).Value!;
        async Task<FinancePayablesPaymentView> PaymentAsync(Guid id) => (await store.GetPaymentAsync(FinanceAccount, id, ct)).Value!;
        async Task<Guid> ApprovedAsync(string reference)
        {
            var id = (await earlier.SaveInvoiceAsync(FinanceAccount, null, new(Guid.NewGuid(), supplier, station.PublicId, reference, earlierDay,
                earlierDay.AddDays(30), fx, new(), [PayablesLine()]), ct)).Value!.Id;
            Assert.True((await earlier.DecideInvoiceAsync(FinanceAccount, id, new(Guid.NewGuid(), (await ViewAsync(id)).Version, "Submitted"), ct)).IsSuccess);
            Assert.True((await earlier.DecideInvoiceAsync(approver, id, new(Guid.NewGuid(), (await ViewAsync(id)).Version, "Approved"), ct)).IsSuccess);
            return id;
        }
        var wrong = await ApprovedAsync("REV-WRONG"); var right = await ApprovedAsync("REV-RIGHT");
        var recorded = await earlier.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, earlierDay, "REV-PAY", fx, 1000), ct);
        Assert.True(recorded.IsSuccess, recorded.Failure);
        var payment = await PaymentAsync(recorded.Value!.Id);
        Assert.True((await earlier.ApplyPaymentAsync(FinanceAccount, payment.Id, new(Guid.NewGuid(), payment.Version,
            [new(wrong, (await ViewAsync(wrong)).Version, 600, 1), new(right, (await ViewAsync(right)).Version, 300, 1)]), ct)).IsSuccess);
        payment = await PaymentAsync(payment.Id);
        Assert.Equal((900m, 100m), (payment.Applied, payment.Remaining));
        var toWrong = Assert.Single(payment.Applications, x => x.InvoiceId == wrong);

        // Reversing needs its own code and a reason; the same request replays it, another body is a conflict.
        var reverse = new FinancePayablesReverse(Guid.NewGuid(), payment.Version, "Aplicado a la factura equivocada", toWrong.Id);
        Assert.Equal("forbidden", (await store.ReversePaymentAsync(clerk, payment.Id, reverse, ct)).Failure);
        Assert.Equal("reason_required", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse with { RequestId = Guid.NewGuid(), Reason = "Mal" }, ct)).Failure);
        Assert.Equal("reason_required", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse with { RequestId = Guid.NewGuid(), Reason = null }, ct)).Failure);
        Assert.Equal("not_found", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse with { RequestId = Guid.NewGuid(), ApplicationId = Guid.NewGuid() }, ct)).Failure);
        async Task<int> NoticesAsync(Guid invoice) => (await db.OutboxMessages.AsNoTracking().Where(m => m.EventType == "account.changed.v1").ToArrayAsync(ct))
            .Select(Elevant.Persistence.Realtime.AccountChangeOutboxWriter.Decode).Count(n => n.Resource == "finance_payables" && n.ResourceId == invoice);
        var notices = await NoticesAsync(wrong);
        var reversed = await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse, ct);
        Assert.True(reversed.IsSuccess, reversed.Failure); Assert.False(reversed.Value!.Replayed);
        Assert.True((await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse, ct)).Value!.Replayed);
        Assert.Equal("idempotency_conflict", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse with { Reason = "Otro motivo distinto" }, ct)).Failure);
        Assert.Equal("version_conflict", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse with { RequestId = Guid.NewGuid() }, ct)).Failure);
        payment = await PaymentAsync(payment.Id);
        Assert.Equal("already_reversed", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, reverse with { RequestId = Guid.NewGuid(), ExpectedVersion = payment.Version }, ct)).Failure);
        Assert.Equal((300m, 700m), (payment.Applied, payment.Remaining));
        Assert.True(await NoticesAsync(wrong) > notices, "the reversed invoice is announced to the payables screens");
        var listed = Assert.Single(payment.Applications, x => x.Id == toWrong.Id);
        Assert.Equal("Aplicado a la factura equivocada", listed.ReversalReason); Assert.NotNull(listed.ReversedAt);
        Assert.Null(Assert.Single(payment.Applications, x => x.InvoiceId == right).ReversedAt);
        Assert.Equal((0m, 1000m), ((await ViewAsync(wrong)).Paid, (await ViewAsync(wrong)).Remaining));
        Assert.Equal(700m, (await ViewAsync(right)).Remaining);
        // The report at a cut-off before the reversal still applies it; from the reversal on it does not.
        Assert.Equal(400m, (await PayablesReportAsync(scope.ServiceProvider, station.PublicId, earlierDay, ct))["REV-WRONG"]);
        var now = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        Assert.Equal(1000m, (await PayablesReportAsync(scope.ServiceProvider, station.PublicId, now, ct))["REV-WRONG"]);

        // The remainder of a payment with a reversed application is applied again, to the right invoice.
        Assert.True((await store.ApplyPaymentAsync(clerk, payment.Id, new(Guid.NewGuid(), payment.Version,
            [new(right, (await ViewAsync(right)).Version, 700, 1)]), ct)).IsSuccess);
        payment = await PaymentAsync(payment.Id);
        Assert.Equal((1000m, 0m), (payment.Applied, payment.Remaining));
        Assert.Equal(0m, (await ViewAsync(right)).Remaining);

        // A payment with active applications is voided only after reversing them.
        var voidIt = new FinancePayablesReverse(Guid.NewGuid(), payment.Version, "Pago registrado por error");
        Assert.Equal("payment_has_applications", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, voidIt, ct)).Failure);
        foreach (var application in payment.Applications.Where(x => x.ReversedAt is null))
        {
            payment = await PaymentAsync(payment.Id);
            Assert.True((await store.ReversePaymentAsync(FinanceAccount, payment.Id, new(Guid.NewGuid(), payment.Version,
                "Pago registrado por error", application.Id), ct)).IsSuccess);
        }
        payment = await PaymentAsync(payment.Id);
        Assert.True((await store.ReversePaymentAsync(FinanceAccount, payment.Id, voidIt with { RequestId = Guid.NewGuid(), ExpectedVersion = payment.Version }, ct)).IsSuccess);
        payment = await PaymentAsync(payment.Id);
        Assert.Equal((0m, 0m, "Pago registrado por error"), (payment.Applied, payment.Remaining, payment.VoidReason));
        Assert.NotNull(payment.VoidedAt);
        Assert.Equal(3, payment.Applications.Count); Assert.All(payment.Applications, x => Assert.NotNull(x.ReversedAt));
        Assert.Equal("already_reversed", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, voidIt with { RequestId = Guid.NewGuid(), ExpectedVersion = payment.Version }, ct)).Failure);
        Assert.Equal("payment_voided", (await store.ApplyPaymentAsync(FinanceAccount, payment.Id, new(Guid.NewGuid(), payment.Version,
            [new(right, (await ViewAsync(right)).Version, 1, 1)]), ct)).Failure);
        Assert.Equal("already_reversed", (await store.ReversePaymentAsync(FinanceAccount, payment.Id, new(Guid.NewGuid(), payment.Version,
            "Revertir otra vez", toWrong.Id), ct)).Failure);
        Assert.DoesNotContain((await store.ListPaymentsAsync(FinanceAccount, new(ScopeStationId: station.PublicId, OutstandingOnly: true), ct)).Value!, x => x.Id == payment.Id);
        Assert.Contains((await store.ListPaymentsAsync(FinanceAccount, new(ScopeStationId: station.PublicId), ct)).Value!, x => x.Id == payment.Id && x.VoidedAt is not null);
        var report = await PayablesReportAsync(scope.ServiceProvider, station.PublicId, now, ct);
        Assert.Equal((1000m, 1000m), (report["REV-WRONG"], report["REV-RIGHT"]));

        // Nothing was changed nor deleted: the history is the payment, its applications and their reversals.
        Assert.Equal(3, await db.Set<FinancePayablesApplication>().CountAsync(ct));
        Assert.Equal(4, await db.Set<FinancePayablesReversal>().CountAsync(ct));
        Assert.Equal(1000m, (await db.Set<FinancePayablesPayment>().AsNoTracking().SingleAsync(x => x.PublicId == payment.Id, ct)).Amount);
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == payment.Id && x.Action == "finance.payable.payment_voided", ct));
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == wrong && x.Action == "finance.payable.application_reversed", ct));
        // Without active applications the approved invoice can be voided now (4-N03).
        Assert.True((await store.DecideInvoiceAsync(FinanceAccount, wrong, new(Guid.NewGuid(), (await ViewAsync(wrong)).Version, "Voided", "Factura sin pagos activos"), ct)).IsSuccess);
    }

    /// <summary>
    /// 4-N14: who creates or submits a supplier invoice does not approve it, and who approves it neither applies a payment
    /// to it nor recorded that payment; the comparison is by person. Rejecting and paying an invoice another person
    /// approved stay possible for its creator.
    /// </summary>
    [Fact]
    public async Task SupplierInvoicesSeparateRegisteringApprovingAndPaying()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var submitter = await AddPayablesExpenseActorAsync(db, "segregation-submitter", ct);
        var approver = await AddPayablesExpenseActorAsync(db, "segregation-approver", ct);
        var station = await db.Stations.FirstAsync(ct);
        var supplier = (await store.SaveSupplierAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "QA-SOD", "Synthetic segregation", null, null, true), ct)).Value!.Id;
        async Task<FinancePayablesView> ViewAsync(Guid id) => (await store.GetInvoiceAsync(FinanceAccount, id, ct)).Value!;
        async Task<FinancePayablesResult<FinancePayablesMutation>> DecideAsync(Guid actor, Guid id, string decision, string? reason = null) =>
            await store.DecideInvoiceAsync(actor, id, new(Guid.NewGuid(), (await ViewAsync(id)).Version, decision, reason), ct);
        var invoice = (await store.SaveInvoiceAsync(FinanceAccount, null, new(Guid.NewGuid(), supplier, station.PublicId, "SOD-0001", PayablesDate,
            PayablesDate.AddDays(30), PayablesUsd, new(), [PayablesLine()]), ct)).Value!.Id;
        Assert.True((await DecideAsync(submitter, invoice, "Submitted")).IsSuccess);
        Assert.Equal("segregation_of_duties", (await DecideAsync(FinanceAccount, invoice, "Approved")).Failure);
        Assert.Equal("segregation_of_duties", (await DecideAsync(submitter, invoice, "Approved")).Failure);
        // The creator may still send it back.
        Assert.True((await DecideAsync(FinanceAccount, invoice, "Rejected", "Falta el anexo del contrato")).IsSuccess);
        Assert.True((await DecideAsync(FinanceAccount, invoice, "Draft", "Se adjuntó el anexo")).IsSuccess);
        Assert.True((await DecideAsync(FinanceAccount, invoice, "Submitted")).IsSuccess);
        Assert.Equal("segregation_of_duties", (await DecideAsync(submitter, invoice, "Approved")).Failure);
        Assert.True((await DecideAsync(approver, invoice, "Approved")).IsSuccess);

        // The approver does not pay it: neither applying a payment nor through a payment it recorded.
        var byApprover = await store.RecordPaymentAsync(approver, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "SOD-PAY-1", PayablesUsd, 400), ct);
        Assert.True(byApprover.IsSuccess, byApprover.Failure);
        var byFinance = await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "SOD-PAY-2", PayablesUsd, 400), ct);
        async Task<FinancePayablesResult<FinancePayablesMutation>> ApplyAsync(Guid actor, Guid paymentId, decimal amount)
        {
            var payment = (await store.GetPaymentAsync(FinanceAccount, paymentId, ct)).Value!;
            return await store.ApplyPaymentAsync(actor, paymentId, new(Guid.NewGuid(), payment.Version, [new(invoice, (await ViewAsync(invoice)).Version, amount, 1)]), ct);
        }
        Assert.Equal("segregation_of_duties", (await ApplyAsync(approver, byFinance.Value!.Id, 100)).Failure);
        Assert.Equal("segregation_of_duties", (await ApplyAsync(FinanceAccount, byApprover.Value!.Id, 100)).Failure);
        Assert.Equal("segregation_of_duties", (await ApplyAsync(submitter, byApprover.Value!.Id, 100)).Failure);
        Assert.Equal(1000m, (await ViewAsync(invoice)).Remaining);
        Assert.True((await ApplyAsync(submitter, byFinance.Value!.Id, 100)).IsSuccess);
        Assert.True((await ApplyAsync(FinanceAccount, byFinance.Value!.Id, 300)).IsSuccess);
        Assert.Equal(600m, (await ViewAsync(invoice)).Remaining);
    }

    /// <summary>
    /// 4-N15: a supplier with an invoice in progress, an approved balance or an unapplied payment is not retired, neither
    /// by DELETE nor by unticking «Proveedor activo». A supplier retired before keeps its invoices voidable and its
    /// recorded payments applicable, and refuses everything else with <c>supplier_inactive</c>.
    /// </summary>
    [Fact]
    public async Task SuppliersWithOpenBalancesAreNotRetiredAndRetiredOnesSayWhy()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var approver = await AddPayablesExpenseActorAsync(db, "retire-approver", ct);
        var station = await db.Stations.FirstAsync(ct);
        var supplierInput = new SupplierSave(Guid.NewGuid(), station.PublicId, "QA-RET", "Synthetic retirement", null, null, true);
        var supplier = (await store.SaveSupplierAsync(FinanceAccount, null, supplierInput, ct)).Value!.Id;
        async Task<SupplierView> SupplierViewAsync() => (await store.GetSupplierAsync(FinanceAccount, supplier, ct)).Value!;
        async Task<FinancePayablesResult<FinancePayablesMutation>> RetireAsync() =>
            await store.DeleteSupplierAsync(FinanceAccount, supplier, new(Guid.NewGuid(), (await SupplierViewAsync()).Version, "Retired", "Proveedor sin contrato vigente"), ct);
        async Task<FinancePayablesResult<FinancePayablesMutation>> UntickAsync(bool active = false) =>
            await store.SaveSupplierAsync(FinanceAccount, supplier, supplierInput with { RequestId = Guid.NewGuid(), IsActive = active, ExpectedVersion = (await SupplierViewAsync()).Version }, ct);
        async Task<FinancePayablesView> ViewAsync(Guid id) => (await store.GetInvoiceAsync(FinanceAccount, id, ct)).Value!;
        async Task<FinancePayablesResult<FinancePayablesMutation>> DecideAsync(Guid actor, Guid id, string decision, string? reason = null) =>
            await store.DecideInvoiceAsync(actor, id, new(Guid.NewGuid(), (await ViewAsync(id)).Version, decision, reason), ct);
        async Task<Guid> InvoiceAsync(string reference) => (await store.SaveInvoiceAsync(FinanceAccount, null, new(Guid.NewGuid(), supplier, station.PublicId,
            reference, PayablesDate, PayablesDate.AddDays(30), PayablesUsd, new(), [PayablesLine()]), ct)).Value!.Id;

        // A draft keeps the supplier working, by either way of retiring it.
        var draft = await InvoiceAsync("RET-DRAFT");
        Assert.Equal("supplier_has_open_balance", (await RetireAsync()).Failure);
        Assert.Equal("supplier_has_open_balance", (await UntickAsync()).Failure);
        Assert.True((await DecideAsync(FinanceAccount, draft, "Voided", "Borrador de prueba")).IsSuccess);
        Assert.True((await RetireAsync()).IsSuccess);
        Assert.True((await UntickAsync(true)).IsSuccess);

        // An approved balance and an unapplied payment too, until the payment settles the invoice.
        var approved = await InvoiceAsync("RET-APPROVED");
        Assert.True((await DecideAsync(FinanceAccount, approved, "Submitted")).IsSuccess);
        Assert.True((await DecideAsync(approver, approved, "Approved")).IsSuccess);
        Assert.Equal("supplier_has_open_balance", (await RetireAsync()).Failure);
        var paid = (await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "RET-PAY", PayablesUsd, 1500), ct)).Value!.Id;
        var payment = (await store.GetPaymentAsync(FinanceAccount, paid, ct)).Value!;
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, paid, new(Guid.NewGuid(), payment.Version, [new(approved, (await ViewAsync(approved)).Version, 1000, 1)]), ct)).IsSuccess);
        Assert.Equal("supplier_has_open_balance", (await RetireAsync()).Failure);
        payment = (await store.GetPaymentAsync(FinanceAccount, paid, ct)).Value!;
        Assert.True((await store.ReversePaymentAsync(FinanceAccount, paid, new(Guid.NewGuid(), payment.Version, "Reaplicar a una sola factura",
            payment.Applications.Single().Id), ct)).IsSuccess);
        payment = (await store.GetPaymentAsync(FinanceAccount, paid, ct)).Value!;
        Assert.True((await store.ReversePaymentAsync(FinanceAccount, paid, new(Guid.NewGuid(), payment.Version, "Monto registrado con error"), ct)).IsSuccess);
        var exact = (await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "RET-PAY-2", PayablesUsd, 1000), ct)).Value!.Id;
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, exact, new(Guid.NewGuid(), (await store.GetPaymentAsync(FinanceAccount, exact, ct)).Value!.Version,
            [new(approved, (await ViewAsync(approved)).Version, 1000, 1)]), ct)).IsSuccess);
        Assert.True((await RetireAsync()).IsSuccess);
        Assert.False((await SupplierViewAsync()).IsActive);

        // A supplier retired before this rule (its invoices in progress) says why, and still settles what it recorded.
        Assert.True((await UntickAsync(true)).IsSuccess);
        var pending = await InvoiceAsync("RET-PENDING"); var submitted = await InvoiceAsync("RET-SUBMITTED"); var open = await InvoiceAsync("RET-OPEN");
        Assert.True((await DecideAsync(FinanceAccount, submitted, "Submitted")).IsSuccess);
        Assert.True((await DecideAsync(FinanceAccount, open, "Submitted")).IsSuccess);
        Assert.True((await DecideAsync(approver, open, "Approved")).IsSuccess);
        var legacy = (await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "RET-LEGACY", PayablesUsd, 500), ct)).Value!.Id;
        await db.Set<Supplier>().Where(x => x.PublicId == supplier).ExecuteUpdateAsync(set => set.SetProperty(x => x.IsActive, false), ct);
        Assert.Equal("supplier_inactive", (await DecideAsync(approver, submitted, "Approved")).Failure);
        Assert.Equal("supplier_inactive", (await DecideAsync(FinanceAccount, pending, "Submitted")).Failure);
        Assert.Equal("supplier_inactive", (await store.SaveInvoiceAsync(FinanceAccount, pending, new(Guid.NewGuid(), supplier, station.PublicId, "RET-PENDING",
            PayablesDate, PayablesDate, PayablesUsd, new(), [PayablesLine(5)], (await ViewAsync(pending)).Version), ct)).Failure);
        Assert.Equal("supplier_inactive", (await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "RET-NEW", PayablesUsd, 10), ct)).Failure);
        Assert.True((await DecideAsync(FinanceAccount, pending, "Voided", "Proveedor retirado")).IsSuccess);
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, legacy, new(Guid.NewGuid(), (await store.GetPaymentAsync(FinanceAccount, legacy, ct)).Value!.Version,
            [new(open, (await ViewAsync(open)).Version, 500, 1)]), ct)).IsSuccess);
        Assert.Equal(500m, (await ViewAsync(open)).Remaining);
    }

    /// <summary>
    /// 4-N13: the requester withdraws a claim its department has not decided, corrects a rejected one and discards a draft
    /// or a rejected one, always with a reason and as status changes with their review stage and audit; nobody else does.
    /// A receipt is removed only from a draft: it stops showing and counting, and its bytes are erased only when no
    /// submission ever included it. A supplier invoice drops an attachment of its draft with the edit code.
    /// </summary>
    [Fact]
    public async Task EmployeeExpensesAreWithdrawnCorrectedAndDiscardedByTheirRequesterWithTheirHistory()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var objects = new PayablesObjects();
        var store = PayablesStore(db, scope.ServiceProvider, objects);
        var requester = await AddPayablesExpenseActorAsync(db, "expense-requester", ct, Department.Contracts, DepartmentAssignmentKind.Member);
        var requesterId = await db.Users.Where(u => u.PublicId == requester).Select(u => u.Id).SingleAsync(ct);
        var station = await db.Stations.FirstAsync(ct);
        EmployeeExpenseSave Claim(string description, decimal price) =>
            new(Guid.NewGuid(), station.PublicId, description, PayablesDate, PayablesUsd, new(), [PayablesLine(price)]);
        async Task<EmployeeExpenseView> ViewAsync(Guid id) => (await store.GetExpenseAsync(requester, id, ct)).Value!;
        async Task<FinancePayablesResult<FinancePayablesMutation>> DecideAsync(Guid actor, Guid id, string decision, string? reason = null) =>
            await store.DecideExpenseAsync(actor, id, new(Guid.NewGuid(), (await ViewAsync(id)).Version, decision, reason), ct);
        async Task<Guid> UploadAsync(Guid id, string text)
        {
            var uploaded = await store.UploadAttachmentAsync(requester, id, true, Guid.NewGuid(), (await ViewAsync(id)).Version, "application/pdf",
                System.Text.Encoding.ASCII.GetBytes("%PDF-1.7 " + text), ct);
            Assert.True(uploaded.IsSuccess, uploaded.Failure); return uploaded.Value!.Id;
        }
        async Task<FinancePayablesResult<FinancePayablesMutation>> RemoveAsync(Guid actor, Guid id, Guid attachment) =>
            await store.RemoveAttachmentAsync(actor, id, true, attachment, new(Guid.NewGuid(), (await ViewAsync(id)).Version), ct);
        async Task<FinancePayablesAttachment> AttachmentAsync(Guid attachment) =>
            await db.Set<FinancePayablesAttachment>().AsNoTracking().SingleAsync(x => x.PublicId == attachment, ct);
        var claim = (await store.SaveExpenseAsync(requester, null, Claim("Taxi al aeropuerto", 25), ct)).Value!.Id;

        // A receipt uploaded by mistake is removed before anyone saw it: hidden, not counted, its bytes erased.
        var mistaken = await UploadAsync(claim, "cedula subida por error");
        var mistakenKey = (await AttachmentAsync(mistaken)).ObjectKey;
        Assert.True(objects.Holds(mistakenKey));
        var removal = new FinancePayablesAttachmentRemoval(Guid.NewGuid(), (await ViewAsync(claim)).Version);
        Assert.Equal("forbidden", (await store.RemoveAttachmentAsync(ContractsAccount, claim, true, mistaken, removal, ct)).Failure);
        var removed = await store.RemoveAttachmentAsync(requester, claim, true, mistaken, removal, ct);
        Assert.True(removed.IsSuccess, removed.Failure); Assert.False(removed.Value!.Replayed);
        Assert.True((await store.RemoveAttachmentAsync(requester, claim, true, mistaken, removal, ct)).Value!.Replayed);
        Assert.Equal("idempotency_conflict", (await store.RemoveAttachmentAsync(requester, claim, true, Guid.NewGuid(), removal, ct)).Failure);
        Assert.False(objects.Holds(mistakenKey));
        var gone = await AttachmentAsync(mistaken);
        Assert.NotNull(gone.RemovedAt); Assert.Equal(requesterId, gone.RemovedByAccountId);
        Assert.Empty((await ViewAsync(claim)).Receipts);
        Assert.Equal("not_found", (await store.DownloadAttachmentAsync(requester, claim, true, mistaken, ct)).Failure);
        Assert.Equal("not_found", (await RemoveAsync(requester, claim, mistaken)).Failure);
        Assert.Equal("receipt_required", (await DecideAsync(requester, claim, "Submitted")).Failure);
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == mistaken && x.Action == "finance.expense.receipt_removed", ct));

        // Submitted, then withdrawn before the department decides, with a reason; only the requester takes it back.
        var seen = await UploadAsync(claim, "factura del taxi");
        Assert.True((await DecideAsync(requester, claim, "Submitted")).IsSuccess);
        Assert.Equal("Department", (await ViewAsync(claim)).ReviewRoute);
        Assert.Equal("forbidden", (await DecideAsync(ContractsAccount, claim, "Draft", "Retiro por otra persona")).Failure);
        Assert.Equal("reason_required", (await DecideAsync(requester, claim, "Draft")).Failure);
        Assert.Equal("invalid_state", (await DecideAsync(requester, claim, "Cancelled", "Descartar en revisión")).Failure);
        Assert.Equal("invalid_state", (await RemoveAsync(requester, claim, seen)).Failure);
        Assert.True((await DecideAsync(requester, claim, "Draft", "Falta un comprobante")).IsSuccess);
        var withdrawn = await ViewAsync(claim);
        Assert.Equal(("Draft", "Withdrawal", "Falta un comprobante"), (withdrawn.Status, withdrawn.Reviews[^1].Stage, withdrawn.Reviews[^1].Reason));
        Assert.Null(withdrawn.ReviewRoute);
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == claim && x.Action == "finance.expense.withdrawn", ct));

        // A receipt that submission included leaves the draft but keeps its bytes, hidden, as what a reviewer could see;
        // one uploaded after it was never presented and is erased.
        Assert.True((await RemoveAsync(requester, claim, seen)).IsSuccess);
        Assert.True(objects.Holds((await AttachmentAsync(seen)).ObjectKey));
        var late = await UploadAsync(claim, "recibo tardio"); var lateKey = (await AttachmentAsync(late)).ObjectKey;
        Assert.True((await RemoveAsync(requester, claim, late)).IsSuccess);
        Assert.False(objects.Holds(lateKey));
        Assert.Empty((await ViewAsync(claim)).Receipts);

        // Rejected by its department, corrected by the requester (back to Draft, edited) and finally discarded.
        await UploadAsync(claim, "factura corregida");
        Assert.True((await DecideAsync(requester, claim, "Submitted")).IsSuccess);
        Assert.True((await DecideAsync(ContractsAccount, claim, "Rejected", "Importe sin soporte")).IsSuccess);
        Assert.Equal("forbidden", (await DecideAsync(ContractsAccount, claim, "Draft", "Corrección de otra persona")).Failure);
        Assert.True((await DecideAsync(requester, claim, "Draft", "Corrijo el importe")).IsSuccess);
        var corrected = await ViewAsync(claim);
        Assert.Equal(("Draft", "Correction"), (corrected.Status, corrected.Reviews[^1].Stage));
        var edited = await store.SaveExpenseAsync(requester, claim, Claim("Taxi al aeropuerto", 20) with { ExpectedVersion = corrected.Version }, ct);
        Assert.True(edited.IsSuccess, edited.Failure);
        Assert.Equal(20m, (await ViewAsync(claim)).Total);
        Assert.True((await DecideAsync(requester, claim, "Cancelled", "Lo registré dos veces")).IsSuccess);
        var discarded = await ViewAsync(claim);
        Assert.Equal(("Cancelled", "Discard", "Lo registré dos veces"), (discarded.Status, discarded.Reviews[^1].Stage, discarded.Reviews[^1].Reason));
        Assert.Equal(["Submission", "Withdrawal", "Submission", "Department", "Correction", "Discard"], discarded.Reviews.Select(r => r.Stage).ToArray());
        Assert.Equal("invalid_state", (await DecideAsync(requester, claim, "Draft", "Reabrir el descartado")).Failure);
        Assert.Equal("invalid_state", (await store.SaveExpenseAsync(requester, claim, Claim("Taxi al aeropuerto", 20) with { ExpectedVersion = discarded.Version }, ct)).Failure);
        Assert.Contains((await store.ListExpensesAsync(requester, new(ScopeStationId: station.PublicId, Status: "Cancelled"), ct)).Value!, x => x.Id == claim);
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == claim && x.Action == "finance.expense.reopened", ct));
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == claim && x.Action == "finance.expense.discarded", ct));

        // A rejected claim is discarded directly, with its reason.
        var second = (await store.SaveExpenseAsync(requester, null, Claim("Almuerzo de turno", 15), ct)).Value!.Id;
        await UploadAsync(second, "almuerzo");
        Assert.True((await DecideAsync(requester, second, "Submitted")).IsSuccess);
        Assert.True((await DecideAsync(ContractsAccount, second, "Rejected", "No es un gasto reembolsable")).IsSuccess);
        Assert.Equal("reason_required", (await DecideAsync(requester, second, "Cancelled")).Failure);
        Assert.True((await DecideAsync(requester, second, "Cancelled", "Acepto el rechazo")).IsSuccess);
        Assert.Equal("Cancelled", (await ViewAsync(second)).Status);
        // Nothing was deleted: every receipt row stays with its removal mark.
        Assert.Equal(5, await db.Set<FinancePayablesAttachment>().CountAsync(x => x.ExpenseClaimId != null, ct));
        Assert.Equal(3, await db.Set<FinancePayablesAttachment>().CountAsync(x => x.RemovedAt != null, ct));

        // A supplier invoice drops an attachment of its draft with the edit code only.
        var reader = await AddPayablesExpenseActorAsync(db, "payables-reader", ct, Department.Finance, DepartmentAssignmentKind.Member);
        await GrantPayablesAsync(db, reader, ct, "finance.payables.read");
        var supplier = (await store.SaveSupplierAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "QA-ATT", "Synthetic attachments", null, null, true), ct)).Value!.Id;
        var bill = (await store.SaveInvoiceAsync(FinanceAccount, null, new(Guid.NewGuid(), supplier, station.PublicId, "ATT-0001", PayablesDate,
            PayablesDate.AddDays(30), PayablesUsd, new(), [PayablesLine()]), ct)).Value!.Id;
        async Task<FinancePayablesView> BillAsync() => (await store.GetInvoiceAsync(FinanceAccount, bill, ct)).Value!;
        var attached = await store.UploadAttachmentAsync(FinanceAccount, bill, false, Guid.NewGuid(), (await BillAsync()).Version, "application/pdf",
            "%PDF-1.7 synthetic supplier invoice"u8.ToArray(), ct);
        Assert.True(attached.IsSuccess, attached.Failure);
        Assert.Equal("forbidden", (await store.RemoveAttachmentAsync(reader, bill, false, attached.Value!.Id, new(Guid.NewGuid(), (await BillAsync()).Version), ct)).Failure);
        Assert.True((await store.RemoveAttachmentAsync(FinanceAccount, bill, false, attached.Value!.Id, new(Guid.NewGuid(), (await BillAsync()).Version), ct)).IsSuccess);
        Assert.Empty((await BillAsync()).Attachments);
        Assert.False(objects.Holds((await AttachmentAsync(attached.Value!.Id)).ObjectKey));
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == attached.Value!.Id && x.Action == "finance.payable.attachment_removed", ct));
    }

    /// <summary>
    /// 4-N13: an expense whose department has no other administrator at the station is reviewed by a Finance administrator
    /// (the «Escalation» stage) and approved by another person of Finance; with another administrator it stays with its
    /// department, and an expense nobody can review says so (route «None») instead of waiting in silence.
    /// </summary>
    [Fact]
    public async Task AnExpenseWithoutAnotherDepartmentReviewerEscalatesToFinance()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var station = await db.Stations.FirstAsync(ct);
        async Task<EmployeeExpenseView> ViewAsync(Guid id) => (await store.GetExpenseAsync(FinanceAccount, id, ct)).Value!;
        async Task<FinancePayablesResult<FinancePayablesMutation>> DecideAsync(Guid actor, Guid id, string decision, string? reason = null) =>
            await store.DecideExpenseAsync(actor, id, new(Guid.NewGuid(), (await ViewAsync(id)).Version, decision, reason), ct);
        async Task<Guid> SubmittedAsync(Guid requester, string description)
        {
            var saved = await store.SaveExpenseAsync(requester, null, new(Guid.NewGuid(), station.PublicId, description, PayablesDate, PayablesUsd,
                new(), [PayablesLine(40)]), ct);
            Assert.True(saved.IsSuccess, saved.Failure); var id = saved.Value!.Id;
            var view = (await store.GetExpenseAsync(requester, id, ct)).Value!;
            Assert.True((await store.UploadAttachmentAsync(requester, id, true, Guid.NewGuid(), view.Version, "application/pdf",
                "%PDF-1.7 synthetic receipt"u8.ToArray(), ct)).IsSuccess);
            view = (await store.GetExpenseAsync(requester, id, ct)).Value!;
            Assert.True((await store.DecideExpenseAsync(requester, id, new(Guid.NewGuid(), view.Version, "Submitted"), ct)).IsSuccess);
            return id;
        }

        // The only Finance administrator files an expense: nobody else of Finance can review it, and the claim says so.
        var alone = await SubmittedAsync(FinanceAccount, "Viaje de auditoría");
        Assert.Equal("None", (await ViewAsync(alone)).ReviewRoute);

        // The seeded OCC administrator is the only one of Operations at the station: a Finance administrator reviews it.
        var occ = await SubmittedAsync(SeededOccAccount, "Combustible del vehículo de rampa");
        Assert.Equal("Finance", (await ViewAsync(occ)).ReviewRoute);
        Assert.Contains((await store.ListExpensesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, Status: "Submitted"), ct)).Value!,
            x => x.Id == occ && x.ReviewRoute == "Finance");
        var member = await AddPayablesExpenseActorAsync(db, "escalation-member", ct, Department.Finance, DepartmentAssignmentKind.Member);
        await GrantPayablesAsync(db, member, ct, "finance.expenses.read", "finance.expenses.approve");
        Assert.Equal("forbidden", (await DecideAsync(member, occ, "DepartmentApproved")).Failure);
        Assert.Equal("forbidden", (await DecideAsync(SeededOccAccount, occ, "DepartmentApproved")).Failure);
        Assert.True((await DecideAsync(FinanceAccount, occ, "DepartmentApproved")).IsSuccess);
        var escalated = await ViewAsync(occ);
        Assert.Equal(("DepartmentApproved", "Escalation"), (escalated.Status, escalated.Reviews[^1].Stage));
        Assert.Null(escalated.ReviewRoute);
        Assert.True(await db.AuditEntries.AnyAsync(x => x.EntityPublicId == occ && x.Action == "finance.expense.escalated_review", ct));
        // Two different people review it: who escalated does not approve it again; another person of Finance does.
        Assert.Equal("segregation_of_duties", (await DecideAsync(FinanceAccount, occ, "Approved")).Failure);
        Assert.True((await DecideAsync(member, occ, "Approved")).IsSuccess);
        Assert.Equal(("Approved", "Finance"), ((await ViewAsync(occ)).Status, (await ViewAsync(occ)).Reviews[^1].Stage));

        // The route follows the staff of the station: a second Finance administrator reviews the first one's expense…
        var second = await AddPayablesExpenseActorAsync(db, "escalation-second-finance", ct);
        Assert.Equal("Department", (await ViewAsync(alone)).ReviewRoute);
        Assert.True((await DecideAsync(second, alone, "DepartmentApproved")).IsSuccess);
        Assert.Equal("Department", (await ViewAsync(alone)).Reviews[^1].Stage);

        // …and a second Operations administrator takes the review back from Finance.
        var operations = await AddPayablesExpenseActorAsync(db, "escalation-second-operations", ct, Department.Operations);
        var back = await SubmittedAsync(SeededOccAccount, "Peaje del vehículo de rampa");
        Assert.Equal("Department", (await ViewAsync(back)).ReviewRoute);
        Assert.Equal("forbidden", (await DecideAsync(FinanceAccount, back, "DepartmentApproved")).Failure);
        Assert.True((await DecideAsync(operations, back, "Rejected", "Sin factura del peaje")).IsSuccess);
        Assert.Equal(("Rejected", "Department"), ((await ViewAsync(back)).Status, (await ViewAsync(back)).Reviews[^1].Stage));
    }

    /// <summary>4-N27: the refusals that used to be a generic conflict, invalid or forbidden carry their own code.</summary>
    [Fact]
    public async Task PayablesAndExpensesRefuseWithTheirStableCodes()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var station = await db.Stations.FirstAsync(ct);

        var supplierInput = new SupplierSave(Guid.NewGuid(), station.PublicId, "QA-CODES", "Synthetic coded supplier", null, null, true);
        var saved = await store.SaveSupplierAsync(FinanceAccount, null, supplierInput, ct); Assert.True(saved.IsSuccess, saved.Failure);
        Assert.Equal("idempotency_conflict", (await store.SaveSupplierAsync(FinanceAccount, null, supplierInput with { Name = "Changed" }, ct)).Failure);
        Assert.Equal("duplicate_supplier_code", (await store.SaveSupplierAsync(FinanceAccount, null,
            supplierInput with { RequestId = Guid.NewGuid(), Code = " qa-codes " }, ct)).Failure);
        var supplier = (await store.GetSupplierAsync(FinanceAccount, saved.Value!.Id, ct)).Value!;
        Assert.Equal("version_conflict", (await store.SaveSupplierAsync(FinanceAccount, supplier.Id,
            supplierInput with { RequestId = Guid.NewGuid(), ExpectedVersion = "stale" }, ct)).Failure);
        Assert.Equal("reason_required", (await store.DeleteSupplierAsync(FinanceAccount, supplier.Id,
            new(Guid.NewGuid(), supplier.Version, "Retired", "Mal"), ct)).Failure);

        var invoiceInput = new FinancePayablesSave(Guid.NewGuid(), supplier.Id, station.PublicId, "CODES-0001", PayablesDate,
            PayablesDate.AddDays(30), PayablesUsd, new(), [PayablesLine()]);
        var created = await store.SaveInvoiceAsync(FinanceAccount, null, invoiceInput, ct); Assert.True(created.IsSuccess, created.Failure);
        Assert.Equal("duplicate_reference", (await store.SaveInvoiceAsync(FinanceAccount, null,
            invoiceInput with { RequestId = Guid.NewGuid(), DocumentReference = "  codes-0001 " }, ct)).Failure);
        var invoice = (await store.GetInvoiceAsync(FinanceAccount, created.Value!.Id, ct)).Value!;
        Assert.Equal("invalid_state", (await store.DecideInvoiceAsync(FinanceAccount, invoice.Id,
            new(Guid.NewGuid(), invoice.Version, "Approved"), ct)).Failure);
        Assert.Equal("invalid", (await store.DecideInvoiceAsync(FinanceAccount, invoice.Id,
            new(Guid.NewGuid(), invoice.Version, "approved"), ct)).Failure);
        Assert.True((await store.DecideInvoiceAsync(FinanceAccount, invoice.Id, new(Guid.NewGuid(), invoice.Version, "Submitted"), ct)).IsSuccess);
        invoice = (await store.GetInvoiceAsync(FinanceAccount, invoice.Id, ct)).Value!;
        Assert.Equal("reason_required", (await store.DecideInvoiceAsync(FinanceAccount, invoice.Id,
            new(Guid.NewGuid(), invoice.Version, "Rejected", "  No  "), ct)).Failure);
        Assert.Equal("reason_required", (await store.DecideInvoiceAsync(FinanceAccount, invoice.Id,
            new(Guid.NewGuid(), invoice.Version, "Rejected", new string('x', 501)), ct)).Failure);
        Assert.Equal("invalid_state", (await store.SaveInvoiceAsync(FinanceAccount, invoice.Id,
            invoiceInput with { RequestId = Guid.NewGuid(), ExpectedVersion = invoice.Version }, ct)).Failure);

        // An expense dated before the employee's assignment to the station is not a missing permission.
        var before = new DateOnly(2025, 12, 31);
        var outside = await store.SaveExpenseAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "Before the assignment",
            before, PayablesUsd with { RateDate = before }, new(), [PayablesLine(10)]), ct);
        Assert.Equal("expense_date_outside_assignment", outside.Failure);
        var expense = await store.SaveExpenseAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "Coded expense",
            PayablesDate, PayablesUsd, new(), [PayablesLine(10)]), ct);
        Assert.True(expense.IsSuccess, expense.Failure);
        var claim = (await store.GetExpenseAsync(FinanceAccount, expense.Value!.Id, ct)).Value!;
        Assert.Equal("receipt_required", (await store.DecideExpenseAsync(FinanceAccount, claim.Id, new(Guid.NewGuid(), claim.Version, "Submitted"), ct)).Failure);
        Assert.Equal("invalid_state", (await store.DecideExpenseAsync(FinanceAccount, claim.Id, new(Guid.NewGuid(), claim.Version, "Approved"), ct)).Failure);
        Assert.Equal("invalid_attachment", (await store.UploadAttachmentAsync(FinanceAccount, claim.Id, true, Guid.NewGuid(), claim.Version,
            "application/pdf", "not a receipt"u8.ToArray(), ct)).Failure);
        Assert.Equal("invalid_attachment", (await store.UploadAttachmentAsync(FinanceAccount, claim.Id, true, Guid.NewGuid(), claim.Version,
            "text/plain", "%PDF-1.7"u8.ToArray(), ct)).Failure);
        for (var receipt = 0; receipt < 20; receipt++)
        {
            claim = (await store.GetExpenseAsync(FinanceAccount, claim.Id, ct)).Value!;
            var uploaded = await store.UploadAttachmentAsync(FinanceAccount, claim.Id, true, Guid.NewGuid(), claim.Version,
                "application/pdf", System.Text.Encoding.ASCII.GetBytes($"%PDF-1.7 synthetic receipt {receipt}"), ct);
            Assert.True(uploaded.IsSuccess, uploaded.Failure);
        }
        claim = (await store.GetExpenseAsync(FinanceAccount, claim.Id, ct)).Value!;
        Assert.Equal("attachment_limit", (await store.UploadAttachmentAsync(FinanceAccount, claim.Id, true, Guid.NewGuid(), claim.Version,
            "application/pdf", "%PDF-1.7 the twenty-first"u8.ToArray(), ct)).Failure);
        Assert.Equal(20, await db.Set<FinancePayablesAttachment>().CountAsync(x => x.ExpenseClaimId != null, ct));
    }

    [Theory]
    [InlineData("Violation of UNIQUE KEY constraint. Cannot insert duplicate key row in object 'commercial.supplier_invoices' with unique index 'IX_supplier_invoices_supplier_id_document_reference'.", "duplicate_reference")]
    [InlineData("Cannot insert duplicate key row in object 'commercial.suppliers' with unique index 'IX_suppliers_scope_station_id_code'.", "duplicate_supplier_code")]
    [InlineData("Cannot insert duplicate key row in object 'commercial.payable_payment_reversals' with unique index 'IX_payable_payment_reversals_application_id'.", "already_reversed")]
    [InlineData("Cannot insert duplicate key row in object 'commercial.finance_payables_commands' with unique index 'IX_finance_payables_commands_actor_account_id_request_id'.", "version_conflict")]
    public void PayablesRacingDuplicateIsClassifiedByItsIndex(string message, string code) =>
        Assert.Equal(code, Elevant.Persistence.Finance.FinancePayablesStore.DuplicateCode(message));
}
