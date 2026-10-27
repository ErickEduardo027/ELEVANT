using System.Collections.Concurrent;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Workforce;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly DateOnly PayablesDate = new(2026, 10, 18);
    private static FinancePayablesFx PayablesUsd => new("USD", 60m, "Synthetic approved FX", PayablesDate);
    private static FinancePayablesStore PayablesStore(ElevantDbContext db, IServiceProvider services, PayablesObjects? objects = null) =>
        new(db, services.GetRequiredService<IActorContextResolver>(), objects ?? new PayablesObjects(), TimeProvider.System);

    [Fact]
    public async Task FinancePayablesPersistUniqueReferencesImmutableLinesAndCommandReceipts()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider);
        var station = await db.Stations.FirstAsync(ct);
        var input = new SupplierSave(Guid.NewGuid(), station.PublicId, "QA-SUPPLIER", "Synthetic Supplier", null, "supplier@example.invalid", true);
        var saved = await store.SaveSupplierAsync(FinanceAccount, null, input, ct); Assert.True(saved.IsSuccess, saved.Failure);
        Assert.True((await store.SaveSupplierAsync(FinanceAccount, null, input, ct)).Value!.Replayed);
        Assert.Equal("conflict", (await store.SaveSupplierAsync(FinanceAccount, null, input with { Name = "Changed" }, ct)).Failure);
        var supplier = (await store.GetSupplierAsync(FinanceAccount, saved.Value!.Id, ct)).Value!;
        Assert.Equal("conflict", (await store.SaveSupplierAsync(FinanceAccount, supplier.Id, input with { RequestId = Guid.NewGuid(), ExpectedVersion = "stale" }, ct)).Failure);
        var invoiceInput = new FinancePayablesSave(Guid.NewGuid(), supplier.Id, station.PublicId, "SUP-0001", PayablesDate, PayablesDate.AddDays(30),
            PayablesUsd, new(), [new("Synthetic service", 2, 500, 0)]);
        var created = await store.SaveInvoiceAsync(FinanceAccount, null, invoiceInput, ct); Assert.True(created.IsSuccess, created.Failure);
        var invoiceId = created.Value!.Id;
        Assert.Equal("conflict", (await store.SaveInvoiceAsync(FinanceAccount, null, invoiceInput with { RequestId = Guid.NewGuid(), DocumentReference = "  sup-0001  " }, ct)).Failure);
        var invoice = (await store.GetInvoiceAsync(FinanceAccount, invoiceId, ct)).Value!;
        Assert.Equal(60000m, invoice.TotalDop); var lineId = Assert.Single(invoice.Lines).Id;
        Assert.True((await store.DecideInvoiceAsync(FinanceAccount, invoiceId, new(Guid.NewGuid(), invoice.Version, "Submitted"), ct)).IsSuccess);
        invoice = (await store.GetInvoiceAsync(FinanceAccount, invoiceId, ct)).Value!;
        Assert.True((await store.DecideInvoiceAsync(FinanceAccount, invoiceId, new(Guid.NewGuid(), invoice.Version, "Approved"), ct)).IsSuccess);
        invoice = (await store.GetInvoiceAsync(FinanceAccount, invoiceId, ct)).Value!;
        Assert.Equal("conflict", (await store.SaveInvoiceAsync(FinanceAccount, invoiceId, invoiceInput with { RequestId = Guid.NewGuid(), ExpectedVersion = invoice.Version }, ct)).Failure);
        await using var restarted = CreateContext(database.ConnectionString);
        var restartedInvoice = await restarted.Set<SupplierInvoice>().SingleAsync(i => i.PublicId == invoiceId, ct);
        Assert.Equal(lineId, (await restarted.Set<SupplierInvoiceLine>().SingleAsync(x => x.DocumentId == restartedInvoice.Id, ct)).PublicId);
        Assert.True(await restarted.AuditEntries.AnyAsync(x => x.EntityPublicId == invoiceId, ct));
        Assert.Equal("forbidden", (await store.GetInvoiceAsync(Guid.Parse("40000000-0000-7000-8000-000000000003"), invoiceId, ct)).Failure);
        var badFx = await store.SaveInvoiceAsync(FinanceAccount, null, invoiceInput with { RequestId = Guid.NewGuid(), DocumentReference = "NO-FX", Fx = PayablesUsd with { RateToDop = null } }, ct);
        Assert.Equal("invalid", badFx.Failure);
        Assert.Contains((await store.OptionsAsync(FinanceAccount, station.PublicId, ct)).Value!.Suppliers, x => x.Id == supplier.Id);
        Assert.True(await db.OutboxMessages.AnyAsync(x => x.PayloadJson.Contains("finance_payables"), ct));
        var financeUserId = await db.Users.Where(x => x.PublicId == FinanceAccount).Select(x => x.Id).SingleAsync(ct);
        foreach (var grant in await db.AccountStationScopes.Where(x => x.AccountId == financeUserId).ToArrayAsync(ct)) grant.RevokedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        Assert.Equal("not_found", (await store.GetInvoiceAsync(FinanceAccount, invoiceId, ct)).Failure);
        Assert.Equal("not_found", (await store.SaveSupplierAsync(FinanceAccount, null, input, ct)).Failure);
    }

    [Fact]
    public async Task FinancePayablesApplicationsAllowMultiplePartialInvoicesAndPreventRacingOverapplication()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var store = PayablesStore(db, scope.ServiceProvider); var station = await db.Stations.FirstAsync(ct);
        var supplier = (await store.SaveSupplierAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "QA-PAY", "Synthetic Payee", null, null, true), ct)).Value!.Id;
        async Task<FinancePayablesView> CreateInvoice(string reference)
        {
            var result = await store.SaveInvoiceAsync(FinanceAccount, null, new(Guid.NewGuid(), supplier, station.PublicId, reference, PayablesDate, PayablesDate,
                PayablesUsd, new(), [new("Synthetic", 1, 1000, 0)]), ct); Assert.True(result.IsSuccess, result.Failure); var id = result.Value!.Id;
            var view = (await store.GetInvoiceAsync(FinanceAccount, id, ct)).Value!;
            Assert.True((await store.DecideInvoiceAsync(FinanceAccount, id, new(Guid.NewGuid(), view.Version, "Submitted"), ct)).IsSuccess);
            view = (await store.GetInvoiceAsync(FinanceAccount, id, ct)).Value!;
            Assert.True((await store.DecideInvoiceAsync(FinanceAccount, id, new(Guid.NewGuid(), view.Version, "Approved"), ct)).IsSuccess);
            return (await store.GetInvoiceAsync(FinanceAccount, id, ct)).Value!;
        }
        var first = await CreateInvoice("PAY-A"); var second = await CreateInvoice("PAY-B");
        var p = await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "PAYMENT", PayablesUsd, 1500), ct);
        Assert.True(p.IsSuccess, p.Failure); var payment = (await store.GetPaymentAsync(FinanceAccount, p.Value!.Id, ct)).Value!;
        var apply = new FinancePayablesApply(Guid.NewGuid(), payment.Version, [new(first.Id, first.Version, 300, 1), new(second.Id, second.Version, 400, 1)]);
        var invalidBatch = apply with { RequestId = Guid.NewGuid(), Applications = [new(first.Id, first.Version, 300, 1), new(second.Id, second.Version, 1200, 1)] };
        Assert.Equal("conflict", (await store.ApplyPaymentAsync(FinanceAccount, payment.Id, invalidBatch, ct)).Failure);
        Assert.Equal(0, await db.Set<FinancePayablesApplication>().CountAsync(ct));
        Assert.Equal(1500m, (await store.GetPaymentAsync(FinanceAccount, payment.Id, ct)).Value!.Remaining);
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, payment.Id, apply, ct)).IsSuccess);
        Assert.True((await store.ApplyPaymentAsync(FinanceAccount, payment.Id, apply, ct)).Value!.Replayed);
        Assert.Equal(700m, (await store.GetInvoiceAsync(FinanceAccount, first.Id, ct)).Value!.Remaining);
        Assert.Equal(800m, (await store.GetPaymentAsync(FinanceAccount, payment.Id, ct)).Value!.Remaining);
        first = (await store.GetInvoiceAsync(FinanceAccount, first.Id, ct)).Value!;
        payment = (await store.GetPaymentAsync(FinanceAccount, payment.Id, ct)).Value!;
        Assert.Equal("conflict", (await store.ApplyPaymentAsync(FinanceAccount, payment.Id, new(Guid.NewGuid(), payment.Version, [new(first.Id, first.Version, 701, 1)]), ct)).Failure);
        var another = await store.RecordPaymentAsync(FinanceAccount, new(Guid.NewGuid(), supplier, station.PublicId, PayablesDate, "PAYMENT-2", PayablesUsd, 1000), ct);
        var payment2 = (await store.GetPaymentAsync(FinanceAccount, another.Value!.Id, ct)).Value!;
        async Task<FinancePayablesResult<FinancePayablesMutation>> Race(Guid paymentId, string version)
        {
            await using var raceScope = provider.CreateAsyncScope(); var raceDb = raceScope.ServiceProvider.GetRequiredService<ElevantDbContext>();
            return await PayablesStore(raceDb, raceScope.ServiceProvider).ApplyPaymentAsync(FinanceAccount, paymentId,
                new(Guid.NewGuid(), version, [new(first.Id, first.Version, 600, 1)]), ct);
        }
        var results = await Task.WhenAll(Race(payment.Id, payment.Version), Race(payment2.Id, payment2.Version));
        Assert.Single(results, x => x.IsSuccess); Assert.Single(results, x => x.Failure == "conflict");
        Assert.Equal(100m, (await store.GetInvoiceAsync(FinanceAccount, first.Id, ct)).Value!.Remaining);
        Assert.Equal(3, await db.Set<FinancePayablesApplication>().CountAsync(ct));
    }

    [Fact]
    public async Task EmployeeExpensesRequirePrivateReceiptsTwoDistinctReviewersAndSeparateReimbursements()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var objects = new PayablesObjects(); var store = PayablesStore(db, scope.ServiceProvider, objects);
        var departmentReviewer = await AddPayablesExpenseActorAsync(db, "department-reviewer", ct);
        var financeReviewer = await AddPayablesExpenseActorAsync(db, "finance-reviewer", ct);
        var station = await db.Stations.FirstAsync(ct);
        var claim = await store.SaveExpenseAsync(FinanceAccount, null, new(Guid.NewGuid(), station.PublicId, "Synthetic travel expense", PayablesDate, PayablesUsd, new(), [new("Synthetic receipt", 1, 1000, 0)]), ct);
        Assert.True(claim.IsSuccess, claim.Failure); var id = claim.Value!.Id;
        var view = (await store.GetExpenseAsync(FinanceAccount, id, ct)).Value!;
        Assert.Equal("receipt_required", (await store.DecideExpenseAsync(FinanceAccount, id, new(Guid.NewGuid(), view.Version, "Submitted"), ct)).Failure);
        var upload = await store.UploadAttachmentAsync(FinanceAccount, id, true, Guid.NewGuid(), view.Version, "application/pdf", "%PDF-1.7 synthetic private receipt"u8.ToArray(), ct);
        Assert.True(upload.IsSuccess, upload.Failure);
        view = (await store.GetExpenseAsync(FinanceAccount, id, ct)).Value!;
        Assert.True((await store.DecideExpenseAsync(FinanceAccount, id, new(Guid.NewGuid(), view.Version, "Submitted"), ct)).IsSuccess);
        view = (await store.GetExpenseAsync(FinanceAccount, id, ct)).Value!;
        Assert.Equal("forbidden", (await store.DecideExpenseAsync(FinanceAccount, id, new(Guid.NewGuid(), view.Version, "DepartmentApproved"), ct)).Failure);
        Assert.Equal("conflict", (await store.DecideExpenseAsync(financeReviewer, id, new(Guid.NewGuid(), view.Version, "Approved"), ct)).Failure);
        Assert.True((await store.DecideExpenseAsync(departmentReviewer, id, new(Guid.NewGuid(), view.Version, "DepartmentApproved"), ct)).IsSuccess);
        view = (await store.GetExpenseAsync(FinanceAccount, id, ct)).Value!;
        Assert.Equal("forbidden", (await store.DecideExpenseAsync(departmentReviewer, id, new(Guid.NewGuid(), view.Version, "Approved"), ct)).Failure);
        Assert.True((await store.DecideExpenseAsync(financeReviewer, id, new(Guid.NewGuid(), view.Version, "Approved"), ct)).IsSuccess);
        view = (await store.GetExpenseAsync(FinanceAccount, id, ct)).Value!;
        var reimbursement = new EmployeeExpensePaymentSave(Guid.NewGuid(), view.Version, PayablesDate, "REIMBURSE", PayablesUsd, 300, 1);
        Assert.Equal("forbidden", (await store.ReimburseExpenseAsync(FinanceAccount, id, reimbursement, ct)).Failure);
        Assert.True((await store.ReimburseExpenseAsync(financeReviewer, id, reimbursement, ct)).IsSuccess);
        Assert.True((await store.ReimburseExpenseAsync(financeReviewer, id, reimbursement, ct)).Value!.Replayed);
        view = (await store.GetExpenseAsync(FinanceAccount, id, ct)).Value!; Assert.Equal(700m, view.Remaining); Assert.Single(view.Reimbursements);
        Assert.Equal("conflict", (await store.ReimburseExpenseAsync(financeReviewer, id, reimbursement with { RequestId = Guid.NewGuid(), ExpectedVersion = view.Version, Amount = 701 }, ct)).Failure);
        Assert.True((await store.DownloadAttachmentAsync(FinanceAccount, id, true, upload.Value!.Id, ct)).IsSuccess);
        Assert.False((await store.DownloadAttachmentAsync(ContractsAccount, id, true, upload.Value!.Id, ct)).IsSuccess);
        objects.Corrupt(); Assert.Equal("unavailable", (await store.DownloadAttachmentAsync(FinanceAccount, id, true, upload.Value.Id, ct)).Failure);
        Assert.Equal(3, view.Reviews.Count); Assert.Equal(1000m, Assert.Single(view.Lines).Total);
    }

    private static async Task<Guid> AddPayablesExpenseActorAsync(ElevantDbContext db, string suffix, CancellationToken ct,
        Department department = Department.Finance, DepartmentAssignmentKind kind = DepartmentAssignmentKind.Administrator)
    {
        var original = await db.Users.AsNoTracking().SingleAsync(x => x.PublicId == FinanceAccount, ct);
        var positionId = await db.JobPositions.AsNoTracking().Where(x => x.Department == department && x.IsActive).Select(x => x.Id).FirstAsync(ct);
        var membership = await db.OrganizationMemberships.AsNoTracking().FirstAsync(x => x.AccountId == original.Id, ct);
        var person = new Person { PublicId = Guid.NewGuid(), FirstName = "Synthetic", LastName = suffix, IdentificationType = "TEST", IdentificationNumber = Guid.NewGuid().ToString("N") };
        db.Persons.Add(person); await db.SaveChangesAsync(ct);
        var account = new ApplicationUser { PublicId = Guid.NewGuid(), PersonId = person.Id, UserName = suffix + "@example.invalid", NormalizedUserName = (suffix + "@example.invalid").ToUpperInvariant(),
            Email = suffix + "@example.invalid", NormalizedEmail = (suffix + "@example.invalid").ToUpperInvariant(), EmailConfirmed = true, Status = AccountLifecycleStatus.Active,
            InvitationStatus = InvitationStatus.Accepted, LockoutEnabled = true, SecurityStamp = Guid.NewGuid().ToString("N"), ConcurrencyStamp = Guid.NewGuid().ToString("N") };
        db.Users.Add(account); await db.SaveChangesAsync(ct);
        var roleCode = DepartmentAccessResolver.RoleCodeOf(department);
        var role = await db.Roles.SingleAsync(x => x.NormalizedName == roleCode, ct);
        db.UserRoles.Add(new IdentityUserRole<long> { UserId = account.Id, RoleId = role.Id });
        db.OrganizationMemberships.Add(new OrganizationMembership { PublicId = Guid.NewGuid(), AccountId = account.Id, OrganizationId = membership.OrganizationId,
            Kind = MembershipKind.InternalStaff, Status = MembershipStatus.Active });
        var employee = new Employee { PublicId = Guid.NewGuid(), PersonId = person.Id, EmployeeNumber = "QA-" + suffix, Department = department,
            JobPositionId = positionId, HireDate = new DateOnly(2026, 1, 1), Status = EmployeeStatus.Active, CreatedByAccountId = original.Id };
        db.Employees.Add(employee);
        db.DepartmentAssignments.Add(new DepartmentAssignment { PublicId = Guid.NewGuid(), AccountId = account.Id, Department = department, Kind = kind });
        await db.SaveChangesAsync(ct);
        foreach (var station in await db.AccountStationScopes.Where(x => x.AccountId == original.Id && x.RevokedAt == null).Select(x => x.StationId).ToArrayAsync(ct))
        {
            db.AccountStationScopes.Add(new AccountStationScope { AccountId = account.Id, StationId = station, GrantedAt = DateTimeOffset.UtcNow });
            db.EmployeeStations.Add(new EmployeeStation { EmployeeId = employee.Id, StationId = station, ValidFrom = new DateOnly(2026, 1, 1) });
        }
        await db.SaveChangesAsync(ct); return account.PublicId;
    }
    private sealed class PayablesObjects : IPrivateFinancialObjectStore
    {
        private readonly ConcurrentDictionary<string, byte[]> contents = new();
        public Task PutAsync(string key, byte[] content, CancellationToken cancellationToken = default) { contents[key] = content.ToArray(); return Task.CompletedTask; }
        public Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default) => Task.FromResult(contents.GetValueOrDefault(key));
        public Task DeleteAsync(string key, CancellationToken cancellationToken = default) { contents.TryRemove(key, out _); return Task.CompletedTask; }
        public void Corrupt() { foreach (var key in contents.Keys) contents[key] = [0]; }
    }
    [Fact]
    public async Task EmployeeExpensesAllowNonFinanceOwnAccessAndMaskOtherEmployeesAndDepartments()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>(); var objects = new PayablesObjects(); var store = PayablesStore(db, scope.ServiceProvider, objects);
        var member = await AddPayablesExpenseActorAsync(db, "contracts-own", ct, Department.Contracts, DepartmentAssignmentKind.Member);
        var peer = await AddPayablesExpenseActorAsync(db, "contracts-peer", ct, Department.Contracts, DepartmentAssignmentKind.Member);
        var operations = await AddPayablesExpenseActorAsync(db, "operations-own", ct, Department.Operations, DepartmentAssignmentKind.Member);
        var station = await db.Stations.FirstAsync(ct);
        var actor = (await scope.ServiceProvider.GetRequiredService<IActorContextResolver>().ResolveAsync(member, ct))!;
        Assert.False(actor.HasPermission("finance.expenses.create")); Assert.False(actor.HasPermission("finance.expenses.read"));
        EmployeeExpenseSave Input(string description) => new(Guid.NewGuid(), station.PublicId, description, PayablesDate, PayablesUsd, new(), [new("Synthetic transport", 1, 100, 0)]);
        var capabilities = (await store.OptionsAsync(member, station.PublicId, ct)).Value!;
        Assert.True(capabilities.CanCreateOwnExpense); Assert.True(capabilities.CanReadOwnExpenses);
        Assert.False(capabilities.CanReviewDepartmentExpenses); Assert.False(capabilities.CanReadFinanceExpenses);
        Assert.True((await store.OptionsAsync(ContractsAccount, station.PublicId, ct)).Value!.CanReviewDepartmentExpenses);
        var ownInput = Input("Contracts own expense");
        var saved = await store.SaveExpenseAsync(member, null, ownInput, ct); Assert.True(saved.IsSuccess, saved.Failure);
        var own = (await store.GetExpenseAsync(member, saved.Value!.Id, ct)).Value!;
        var linkedEmployee = await (from e in db.Employees join u in db.Users on e.PersonId equals u.PersonId where u.PublicId == member select e.PublicId).SingleAsync(ct);
        Assert.Equal(linkedEmployee, own.EmployeeId); Assert.Equal(member, own.RequesterId);
        Assert.True((await store.SaveExpenseAsync(member, null, ownInput, ct)).Value!.Replayed);
        var peerSaved = await store.SaveExpenseAsync(peer, null, Input("Peer expense"), ct); Assert.True(peerSaved.IsSuccess, peerSaved.Failure);
        var peerView = (await store.GetExpenseAsync(peer, peerSaved.Value!.Id, ct)).Value!;
        var operationsSaved = await store.SaveExpenseAsync(operations, null, Input("Operations expense"), ct); Assert.True(operationsSaved.IsSuccess, operationsSaved.Failure);
        Assert.Equal("not_found", (await store.GetExpenseAsync(member, peerView.Id, ct)).Failure);
        Assert.Equal("not_found", (await store.SaveExpenseAsync(member, peerView.Id, Input("Impersonation attempt") with { ExpectedVersion = peerView.Version }, ct)).Failure);
        Assert.Equal("not_found", (await store.DecideExpenseAsync(member, peerView.Id, new(Guid.NewGuid(), peerView.Version, "Submitted"), ct)).Failure);
        Assert.Single((await store.ListExpensesAsync(member, new(ScopeStationId: station.PublicId), ct)).Value!);
        Assert.Empty((await store.ListExpensesAsync(member, new(ScopeStationId: station.PublicId, EmployeeId: peerView.EmployeeId), ct)).Value!);
        Assert.Equal(2, (await store.ListExpensesAsync(ContractsAccount, new(ScopeStationId: station.PublicId), ct)).Value!.Count);
        Assert.Empty((await store.ListExpensesAsync(ContractsAccount, new(ScopeStationId: station.PublicId, OwnOnly: true), ct)).Value!);
        Assert.Equal("not_found", (await store.GetExpenseAsync(ContractsAccount, operationsSaved.Value!.Id, ct)).Failure);
        var uploaded = await store.UploadAttachmentAsync(member, own.Id, true, Guid.NewGuid(), own.Version, "application/pdf", "%PDF-1.7 synthetic"u8.ToArray(), ct);
        Assert.True(uploaded.IsSuccess, uploaded.Failure); own = (await store.GetExpenseAsync(member, own.Id, ct)).Value!;
        Assert.True((await store.DownloadAttachmentAsync(member, own.Id, true, uploaded.Value!.Id, ct)).IsSuccess);
        Assert.Equal("not_found", (await store.DownloadAttachmentAsync(peer, own.Id, true, uploaded.Value.Id, ct)).Failure);
        Assert.True((await store.DecideExpenseAsync(member, own.Id, new(Guid.NewGuid(), own.Version, "Submitted"), ct)).IsSuccess);
        own = (await store.GetExpenseAsync(member, own.Id, ct)).Value!;
        Assert.Equal("forbidden", (await store.DecideExpenseAsync(member, own.Id, new(Guid.NewGuid(), own.Version, "DepartmentApproved"), ct)).Failure);
        Assert.True((await store.DecideExpenseAsync(ContractsAccount, own.Id, new(Guid.NewGuid(), own.Version, "DepartmentApproved"), ct)).IsSuccess);
        own = (await store.GetExpenseAsync(member, own.Id, ct)).Value!;
        Assert.Equal("forbidden", (await store.DecideExpenseAsync(ContractsAccount, own.Id, new(Guid.NewGuid(), own.Version, "Approved"), ct)).Failure);
        Assert.True((await store.DecideExpenseAsync(FinanceAccount, own.Id, new(Guid.NewGuid(), own.Version, "Approved"), ct)).IsSuccess);
        var adminOwnSaved = await store.SaveExpenseAsync(ContractsAccount, null, Input("Administrator own expense"), ct); Assert.True(adminOwnSaved.IsSuccess, adminOwnSaved.Failure);
        var adminOwn = (await store.GetExpenseAsync(ContractsAccount, adminOwnSaved.Value!.Id, ct)).Value!;
        Assert.True((await store.UploadAttachmentAsync(ContractsAccount, adminOwn.Id, true, Guid.NewGuid(), adminOwn.Version, "application/pdf", "%PDF-1.7 admin synthetic"u8.ToArray(), ct)).IsSuccess);
        adminOwn = (await store.GetExpenseAsync(ContractsAccount, adminOwn.Id, ct)).Value!;
        Assert.True((await store.DecideExpenseAsync(ContractsAccount, adminOwn.Id, new(Guid.NewGuid(), adminOwn.Version, "Submitted"), ct)).IsSuccess);
        adminOwn = (await store.GetExpenseAsync(ContractsAccount, adminOwn.Id, ct)).Value!;
        Assert.Equal("forbidden", (await store.DecideExpenseAsync(ContractsAccount, adminOwn.Id, new(Guid.NewGuid(), adminOwn.Version, "DepartmentApproved"), ct)).Failure);
        var userId = await db.Users.Where(u => u.PublicId == member).Select(u => u.Id).SingleAsync(ct);
        var notices = (await db.OutboxMessages.Where(m => m.EventType == "account.changed.v1").ToArrayAsync(ct)).Select(AccountChangeOutboxWriter.Decode).ToArray();
        Assert.Contains(notices, n => n.RecipientAccountId == userId && n.Resource == "finance_expenses" && n.ResourceId == own.Id);
        var peerUserId = await db.Users.Where(u => u.PublicId == peer).Select(u => u.Id).SingleAsync(ct);
        Assert.DoesNotContain(notices, n => n.RecipientAccountId == peerUserId && n.ResourceId == own.Id);
        Assert.Equal(4, (await store.ListExpensesAsync(FinanceAccount, new(ScopeStationId: station.PublicId), ct)).Value!.Count);
        Assert.Empty((await store.ListExpensesAsync(FinanceAccount, new(ScopeStationId: station.PublicId, DepartmentOnly: true), ct)).Value!);
    }
}
