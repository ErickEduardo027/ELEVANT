using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Persistence.Finance;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task FinancePayablesSettlementDatesRejectFuturePaymentsAndCurrentPaymentsStillApply()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var clock = new PayablesSettlementClock(DateTimeOffset.UtcNow);
        var today = Elevant.Application.Common.BusinessCalendar.Today(clock.GetUtcNow());
        var store = new FinancePayablesStore(db, scope.ServiceProvider.GetRequiredService<IActorContextResolver>(), new PayablesObjects(), clock);
        var station = await db.Stations.FirstAsync(ct);
        var supplier = await CreateSettlementSupplierAsync(store, station.PublicId, ct);
        var invoice = await CreateSettlementInvoiceAsync(store, supplier, station.PublicId, today, "SETTLEMENT-CURRENT", ct);
        var commands = await db.Set<FinancePayablesCommand>().CountAsync(ct);
        var audits = await db.AuditEntries.CountAsync(ct);
        var outbox = await db.OutboxMessages.CountAsync(ct);
        var future = new FinancePayablesPaymentSave(Guid.NewGuid(), supplier, station.PublicId, today.AddDays(30),
            "FUTURE-ATTEMPT", SettlementFx(today), 1000);

        Assert.Equal("invalid", (await store.RecordPaymentAsync(FinanceAccount, future, ct)).Failure);
        Assert.Empty(await db.Set<FinancePayablesPayment>().ToArrayAsync(ct));
        Assert.Equal(commands, await db.Set<FinancePayablesCommand>().CountAsync(ct));
        Assert.Equal(audits, await db.AuditEntries.CountAsync(ct));
        Assert.Equal(outbox, await db.OutboxMessages.CountAsync(ct));
        Assert.Equal(1000m, (await store.GetInvoiceAsync(FinanceAccount, invoice.Id, ct)).Value!.Remaining);
        await AssertSettlementReportAsync(scope.ServiceProvider, "payables", station.PublicId, today, "reference", invoice.DocumentReference, 1000, ct);

        // The rejected intent reserved nothing; correcting its date can commit normally.
        var current = future with { PaidOn = today };
        var recorded = await store.RecordPaymentAsync(FinanceAccount, current, ct);
        Assert.True(recorded.IsSuccess, recorded.Failure);
        var payment = (await store.GetPaymentAsync(FinanceAccount, recorded.Value!.Id, ct)).Value!;
        var apply = new FinancePayablesApply(Guid.NewGuid(), payment.Version, [new(invoice.Id, invoice.Version, 300, 1)]);
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, payment.Id, apply, ct)).IsSuccess);
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, payment.Id, apply, ct)).Value!.Replayed);
        var updated = (await store.GetInvoiceAsync(FinanceAccount, invoice.Id, ct)).Value!;
        Assert.Equal(300m, updated.Paid);
        Assert.Equal(700m, updated.Remaining);
        Assert.Equal(700m, (await store.GetPaymentAsync(FinanceAccount, payment.Id, ct)).Value!.Remaining);
        Assert.Contains((await store.ListInvoicesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, OutstandingOnly: true), ct)).Value!, i => i.Id == invoice.Id && i.Remaining == 700);
        await AssertSettlementReportAsync(scope.ServiceProvider, "payables", station.PublicId, today, "reference", invoice.DocumentReference, 700, ct);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task FinancePayablesSettlementDatesExcludePersistedFutureApplicationsAndBlockNewOnes(bool futureCreationTimestamp)
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var clock = new PayablesSettlementClock(DateTimeOffset.UtcNow);
        var today = Elevant.Application.Common.BusinessCalendar.Today(clock.GetUtcNow());
        var store = new FinancePayablesStore(db, scope.ServiceProvider.GetRequiredService<IActorContextResolver>(), new PayablesObjects(), clock);
        var station = await db.Stations.FirstAsync(ct);
        var supplierId = await CreateSettlementSupplierAsync(store, station.PublicId, ct);
        var first = await CreateSettlementInvoiceAsync(store, supplierId, station.PublicId, today, "SETTLEMENT-LEGACY", ct);
        var second = await CreateSettlementInvoiceAsync(store, supplierId, station.PublicId, today, "SETTLEMENT-TARGET", ct);
        var supplier = await db.Set<Supplier>().SingleAsync(s => s.PublicId == supplierId, ct);
        var actor = await db.Users.Where(u => u.PublicId == FinanceAccount).Select(u => u.Id).SingleAsync(ct);
        var firstId = await db.Set<SupplierInvoice>().Where(i => i.PublicId == first.Id).Select(i => i.Id).SingleAsync(ct);
        // Reproduce already persisted data from the old bug without changing schema or deleting its history.
        var legacy = new FinancePayablesPayment
        {
            PublicId = Guid.CreateVersion7(), SupplierId = supplier.Id, ScopeStationId = station.Id,
            Reference = "LEGACY-FUTURE", PaidOn = futureCreationTimestamp ? today : today.AddDays(30), CurrencyCode = "USD", FxToDop = 60,
            FxSource = "Synthetic legacy settlement", FxDate = today, Amount = 2000, AmountDop = 120000,
            CreatedByAccountId = actor, CreatedAt = futureCreationTimestamp ? clock.GetUtcNow().AddDays(30) : clock.GetUtcNow(), UpdatedAt = clock.GetUtcNow(),
        };
        db.Add(legacy);
        await db.SaveChangesAsync(ct);
        db.Add(new FinancePayablesApplication
        {
            PublicId = Guid.CreateVersion7(), PaymentId = legacy.Id, SupplierInvoiceId = firstId,
            PaymentAmount = 1000, InvoiceAmount = 1000, RateToInvoice = 1, ActorAccountId = actor, AppliedAt = clock.GetUtcNow(),
        });
        await db.SaveChangesAsync(ct);

        var visible = (await store.GetInvoiceAsync(FinanceAccount, first.Id, ct)).Value!;
        Assert.Equal(0m, visible.Paid);
        Assert.Equal(1000m, visible.Remaining);
        Assert.Contains((await store.ListInvoicesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, OutstandingOnly: true), ct)).Value!, i => i.Id == first.Id);
        await AssertSettlementReportAsync(scope.ServiceProvider, "payables", station.PublicId, today, "reference", first.DocumentReference, 1000, ct);
        Assert.DoesNotContain((await store.ListPaymentsAsync(FinanceAccount, new(ScopeStationId: station.PublicId, OutstandingOnly: true), ct)).Value!, p => p.Id == legacy.PublicId);
        var futureView = (await store.GetPaymentAsync(FinanceAccount, legacy.PublicId, ct)).Value!;
        Assert.Equal(0m, futureView.Applied);
        Assert.Equal(0m, futureView.Remaining); // No currently available funds from an invalid future receipt.
        Assert.Empty(futureView.Applications);
        var commands = await db.Set<FinancePayablesCommand>().CountAsync(ct);
        var audits = await db.AuditEntries.CountAsync(ct);
        var outbox = await db.OutboxMessages.CountAsync(ct);
        var rejected = await store.ApplyPaymentAsync(FinanceAccount, legacy.PublicId,
            new(Guid.NewGuid(), futureView.Version, [new(second.Id, second.Version, 1000, 1)]), ct);
        Assert.Equal("invalid", rejected.Failure);
        Assert.Equal(commands, await db.Set<FinancePayablesCommand>().CountAsync(ct));
        Assert.Equal(audits, await db.AuditEntries.CountAsync(ct));
        Assert.Equal(outbox, await db.OutboxMessages.CountAsync(ct));
        Assert.Single(await db.Set<FinancePayablesApplication>().ToArrayAsync(ct));
        Assert.Equal(1000m, (await store.GetInvoiceAsync(FinanceAccount, second.Id, ct)).Value!.Remaining);

        var recorded = await store.RecordPaymentAsync(FinanceAccount,
            new(Guid.NewGuid(), supplierId, station.PublicId, today, "CURRENT-SETTLEMENT", SettlementFx(today), 1000), ct);
        Assert.True(recorded.IsSuccess, recorded.Failure);
        var payment = (await store.GetPaymentAsync(FinanceAccount, recorded.Value!.Id, ct)).Value!;
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, payment.Id,
            new(Guid.NewGuid(), payment.Version, [new(second.Id, second.Version, 1000, 1)]), ct)).IsSuccess);
        Assert.Equal(0m, (await store.GetInvoiceAsync(FinanceAccount, second.Id, ct)).Value!.Remaining);
        var outstanding = (await store.ListInvoicesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, OutstandingOnly: true), ct)).Value!;
        Assert.Contains(outstanding, i => i.Id == first.Id);
        Assert.DoesNotContain(outstanding, i => i.Id == second.Id);
        await AssertSettlementReportAsync(scope.ServiceProvider, "payables", station.PublicId, today, "reference", second.DocumentReference, 0, ct);
        Assert.Equal(2, await db.Set<FinancePayablesApplication>().CountAsync(ct));
    }

    [Fact]
    public async Task FinancePayablesSettlementDatesRejectFutureReimbursementsAndKeepExpenseBalancesCurrent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var departmentReviewer = await AddPayablesExpenseActorAsync(db, "settlement-department", ct);
        var financeReviewer = await AddPayablesExpenseActorAsync(db, "settlement-finance", ct);
        var clock = new PayablesSettlementClock(DateTimeOffset.UtcNow);
        var today = Elevant.Application.Common.BusinessCalendar.Today(clock.GetUtcNow());
        var store = new FinancePayablesStore(db, scope.ServiceProvider.GetRequiredService<IActorContextResolver>(), new PayablesObjects(), clock);
        var station = await db.Stations.FirstAsync(ct);
        var saved = await store.SaveExpenseAsync(FinanceAccount, null,
            new(Guid.NewGuid(), station.PublicId, "Synthetic settlement expense", today, SettlementFx(today), new(), [new("Synthetic transport", 1, 1000, 0)]), ct);
        Assert.True(saved.IsSuccess, saved.Failure);
        var expense = (await store.GetExpenseAsync(FinanceAccount, saved.Value!.Id, ct)).Value!;
        Assert.True((await store.UploadAttachmentAsync(FinanceAccount, expense.Id, true, Guid.NewGuid(), expense.Version,
            "application/pdf", "%PDF-1.7 synthetic settlement receipt"u8.ToArray(), ct)).IsSuccess);
        foreach (var (reviewer, decision) in new[] { (FinanceAccount, "Submitted"), (departmentReviewer, "DepartmentApproved"), (financeReviewer, "Approved") })
        {
            expense = (await store.GetExpenseAsync(FinanceAccount, expense.Id, ct)).Value!;
            Assert.True((await store.DecideExpenseAsync(reviewer, expense.Id, new(Guid.NewGuid(), expense.Version, decision), ct)).IsSuccess);
        }
        expense = (await store.GetExpenseAsync(FinanceAccount, expense.Id, ct)).Value!;
        var commands = await db.Set<FinancePayablesCommand>().CountAsync(ct);
        var audits = await db.AuditEntries.CountAsync(ct);
        var outbox = await db.OutboxMessages.CountAsync(ct);
        var future = new EmployeeExpensePaymentSave(Guid.NewGuid(), expense.Version, today.AddDays(30), "FUTURE-REIMBURSEMENT", SettlementFx(today), 1000, 1);
        Assert.Equal("invalid", (await store.ReimburseExpenseAsync(financeReviewer, expense.Id, future, ct)).Failure);
        Assert.Empty(await db.Set<EmployeeExpensePayment>().ToArrayAsync(ct));
        Assert.Equal(commands, await db.Set<FinancePayablesCommand>().CountAsync(ct));
        Assert.Equal(audits, await db.AuditEntries.CountAsync(ct));
        Assert.Equal(outbox, await db.OutboxMessages.CountAsync(ct));

        var claimId = await db.Set<EmployeeExpenseClaim>().Where(e => e.PublicId == expense.Id).Select(e => e.Id).SingleAsync(ct);
        var actor = await db.Users.Where(u => u.PublicId == financeReviewer).Select(u => u.Id).SingleAsync(ct);
        db.Add(new EmployeeExpensePayment
        {
            PublicId = Guid.CreateVersion7(), ExpenseClaimId = claimId, Reference = "LEGACY-FUTURE-REIMBURSEMENT",
            PaidOn = today.AddDays(30), CurrencyCode = "USD", FxToDop = 60, FxSource = "Synthetic legacy settlement",
            FxDate = today, Amount = 200, AmountDop = 12000, ExpenseAmount = 200, RateToExpense = 1,
            ActorAccountId = actor, CreatedAt = clock.GetUtcNow(),
        });
        await db.SaveChangesAsync(ct);
        expense = (await store.GetExpenseAsync(FinanceAccount, expense.Id, ct)).Value!;
        Assert.Equal(0m, expense.Paid);
        Assert.Equal(1000m, expense.Remaining);
        Assert.Empty(expense.Reimbursements);
        Assert.Contains((await store.ListExpensesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, OutstandingOnly: true), ct)).Value!, e => e.Id == expense.Id && e.Remaining == 1000);
        await AssertSettlementReportAsync(scope.ServiceProvider, "expenses", station.PublicId, today, "employee", expense.EmployeeNumber, 1000, ct);

        var current = future with { RequestId = Guid.NewGuid(), PaidOn = today, Reference = "CURRENT-REIMBURSEMENT", Amount = 300, ExpectedVersion = expense.Version };
        Assert.True((await store.ReimburseExpenseAsync(financeReviewer, expense.Id, current, ct)).IsSuccess);
        Assert.True((await store.ReimburseExpenseAsync(financeReviewer, expense.Id, current, ct)).Value!.Replayed);
        expense = (await store.GetExpenseAsync(FinanceAccount, expense.Id, ct)).Value!;
        Assert.Equal(300m, expense.Paid);
        Assert.Equal(700m, expense.Remaining);
        Assert.Single(expense.Reimbursements);
        await AssertSettlementReportAsync(scope.ServiceProvider, "expenses", station.PublicId, today, "employee", expense.EmployeeNumber, 700, ct);
        Assert.Equal(2, await db.Set<EmployeeExpensePayment>().CountAsync(ct)); // Legacy evidence remains intact.
    }

    private static FinancePayablesFx SettlementFx(DateOnly date) => new("USD", 60, "Synthetic settlement FX", date);

    private static async Task<Guid> CreateSettlementSupplierAsync(FinancePayablesStore store, Guid station, CancellationToken ct)
    {
        var saved = await store.SaveSupplierAsync(FinanceAccount, null, new(Guid.NewGuid(), station, "SETTLEMENT", "Synthetic settlement supplier", null, null, true), ct);
        Assert.True(saved.IsSuccess, saved.Failure);
        return saved.Value!.Id;
    }

    private static async Task<FinancePayablesView> CreateSettlementInvoiceAsync(FinancePayablesStore store, Guid supplier, Guid station,
        DateOnly date, string reference, CancellationToken ct)
    {
        var saved = await store.SaveInvoiceAsync(FinanceAccount, null,
            new(Guid.NewGuid(), supplier, station, reference, date, date.AddDays(30), SettlementFx(date), new(), [new("Synthetic settlement bill", 1, 1000, 0)]), ct);
        Assert.True(saved.IsSuccess, saved.Failure);
        foreach (var decision in new[] { "Submitted", "Approved" })
        {
            var view = (await store.GetInvoiceAsync(FinanceAccount, saved.Value!.Id, ct)).Value!;
            Assert.True((await store.DecideInvoiceAsync(FinanceAccount, view.Id, new(Guid.NewGuid(), view.Version, decision), ct)).IsSuccess);
        }
        return (await store.GetInvoiceAsync(FinanceAccount, saved.Value!.Id, ct)).Value!;
    }

    private static async Task AssertSettlementReportAsync(IServiceProvider services, string key, Guid station, DateOnly today,
        string matchColumn, string matchValue, decimal expectedBalance, CancellationToken ct)
    {
        var report = await services.GetRequiredService<IFinanceReportStore>().GetAsync(FinanceAccount, key,
            new(today.AddDays(-1), today, station, null, "USD"), ct);
        Assert.NotNull(report);
        var matchIndex = report.Columns.ToList().FindIndex(c => c.Key == matchColumn);
        var balanceIndex = report.Columns.ToList().FindIndex(c => c.Key == "balance");
        Assert.True(matchIndex >= 0 && balanceIndex >= 0);
        var row = Assert.Single(report.Rows, r => r[matchIndex] == matchValue);
        Assert.Equal(expectedBalance, decimal.Parse(row[balanceIndex]!, CultureInfo.InvariantCulture));
    }

    private sealed class PayablesSettlementClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
