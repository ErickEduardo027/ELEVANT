using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
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
    public async Task FinanceTaxPoliciesEnforceScopeReplayExplicitZeroAndAmbiguity()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var station = await db.Stations.SingleAsync(s => s.Code == "PUJ", ct); var airline = await db.Airlines.FirstAsync(ct);
        var store = new FinanceTaxStore(db, new TaxTestActors(station.PublicId), TimeProvider.System);
        var input = new FinanceTaxPolicyInput(Guid.NewGuid(), airline.PublicId, station.PublicId, "USD", "Adjustment", "AJUSTE", "Taxable", 0, null, new(2026, 1, 1), null, null, null);
        Assert.Equal("forbidden", (await store.CreateAsync(Guid.NewGuid(), input, ct)).Code);
        var created = await store.CreateAsync(FinanceAccount, input, ct); Assert.True(created.IsSuccess, created.Code);
        Assert.Equal(created.Id, (await store.CreateAsync(FinanceAccount, input, ct)).Id);
        Assert.Equal("idempotency_conflict", (await store.CreateAsync(FinanceAccount, input with { Rate = 2 }, ct)).Code);
        var row = Assert.Single((await store.ListAsync(FinanceAccount, ct))!);
        var command = new FinanceTaxCommandInput(Guid.NewGuid(), row.Version);
        Assert.True((await store.PublishAsync(FinanceAccount, row.Id, command, ct)).IsSuccess);
        Assert.True((await store.PublishAsync(FinanceAccount, row.Id, command, ct)).IsSuccess);
        Assert.Equal("version_conflict", (await store.PublishAsync(FinanceAccount, row.Id, command with { RequestId = Guid.NewGuid() }, ct)).Code);
        var duplicate = await store.CreateAsync(FinanceAccount, input with { RequestId = Guid.NewGuid(), Rate = 3 }, ct);
        var other = (await store.ListAsync(FinanceAccount, ct))!.Single(p => p.Id == duplicate.Id);
        Assert.Equal("ambiguous_tax_policy", (await store.PublishAsync(FinanceAccount, other.Id, new(Guid.NewGuid(), other.Version), ct)).Code);
        Assert.Equal("invalid_tax_policy", (await store.CreateAsync(FinanceAccount, input with { RequestId = Guid.NewGuid(), Treatment = "Exempt", Rate = null }, ct)).Code);
        db.ChangeTracker.Clear();
        var policy = await db.Set<FinanceTaxPolicy>().SingleAsync(p => p.PublicId == row.Id, ct);
        policy.Rate = 2;
        await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync(ct));
        db.ChangeTracker.Clear();
        var account = await db.Users.SingleAsync(u => u.PublicId == FinanceAccount, ct); var now = DateTimeOffset.UtcNow;
        var draft = new Preinvoice { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id,
            CreatedByAccountId = account.Id, RequestId = Guid.NewGuid(), PayloadHash = new string('a', 64), From = new(2026, 10, 1), To = new(2026, 10, 31), CurrencyCode = "USD", CreatedAt = now, UpdatedAt = now };
        db.Preinvoices.Add(draft); await db.SaveChangesAsync(ct);
        var line = TaxLine(draft.Id, 1, "AJUSTE", 100); var missing = TaxLine(draft.Id, 2, "MISSING", 50);
        db.PreinvoiceLines.AddRange(line, missing);
        await FinanceTaxSnapshotWriter.ApplyOnceAsync(db, draft, [line, missing], now, ct); await db.SaveChangesAsync(ct);
        Assert.Equal(100, line.Amount); Assert.Equal(0, line.TaxAmount); Assert.Null(missing.TaxAmount); Assert.Equal(150, draft.Total);
        var detail = (await store.GetPreinvoiceAsync(FinanceAccount, draft.PublicId, ct))!;
        Assert.False(detail.TreatmentsConfigured); Assert.Null(detail.Tax);
        Assert.Null(await store.GetPreinvoiceAsync(Guid.NewGuid(), draft.PublicId, ct));
        // A corrupt/parallel published match is detected; no precedence is silently guessed.
        db.ChangeTracker.Clear(); var collision = await db.Set<FinanceTaxPolicy>().SingleAsync(p => p.PublicId == other.Id, ct);
        collision.Status = FinanceTaxPolicyStatus.Published; await db.SaveChangesAsync(ct);
        var edit = scope.ServiceProvider.GetRequiredService<IPreinvoiceLineEditStore>();
        Assert.Equal(FinanceCatalogFailure.Conflict, (await edit.EditLineAsync(FinanceAccount, draft.PublicId, line.PublicId,
            new(120, false, "Synthetic adjustment edit", detail.Version), ct)).Failure);
        Assert.Equal(100, await db.PreinvoiceLines.Where(l => l.PublicId == line.PublicId).Select(l => l.Amount).SingleAsync(ct));
        db.ChangeTracker.Clear(); var accepted = await db.Preinvoices.SingleAsync(p => p.PublicId == draft.PublicId, ct);
        accepted.Status = PreinvoiceStatus.Accepted; await db.SaveChangesAsync(ct);
        var issue = await scope.ServiceProvider.GetRequiredService<IFinanceInvoiceIssueStore>()
            .IssueAsync(new(FinanceAccount, draft.PublicId, Guid.NewGuid()), ct);
        Assert.True(issue.IsSuccess, issue.Failure?.ToString());
        db.ChangeTracker.Clear(); var unknownInvoice = await db.NonFiscalInvoices.SingleAsync(i => i.PublicId == issue.InvoiceId, ct);
        var unknownLines = await db.NonFiscalInvoiceLines.Where(l => l.InvoiceId == unknownInvoice.Id).ToArrayAsync(ct);
        Assert.Equal(150, unknownInvoice.Total); Assert.Null(unknownInvoice.TaxTotal);
        Assert.False(FinanceTaxSnapshotWriter.HasConfiguredIssuedTreatments(unknownInvoice, unknownLines));
    }

    [Fact]
    public async Task FinanceTaxInvoiceIssueFreezesTotalsIdentityAndTreatmentsAcrossLaterChanges()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct); await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var station = await db.Stations.SingleAsync(s => s.Code == "PUJ", ct); var airline = await db.Airlines.FirstAsync(ct);
        var account = await db.Users.SingleAsync(u => u.PublicId == FinanceAccount, ct); var now = DateTimeOffset.UtcNow;
        var draft = new Preinvoice { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id,
            CreatedByAccountId = account.Id, RequestId = Guid.NewGuid(), PayloadHash = new string('a', 64), From = new(2026, 10, 1), To = new(2026, 10, 31), CurrencyCode = "USD", Status = PreinvoiceStatus.Draft, CreatedAt = now, UpdatedAt = now };
        db.Preinvoices.Add(draft); await db.SaveChangesAsync(ct);
        var policy = new FinanceTaxPolicy { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id,
            CurrencyCode = "USD", ConceptKind = PreinvoiceLineKind.Adjustment, ConceptCode = "QA", Treatment = FinanceTaxTreatment.Taxable,
            Rate = 20, Status = FinanceTaxPolicyStatus.Published, ValidFrom = new(2026, 1, 1), CreatedByAccountId = account.Id, CreatedAt = now, UpdatedAt = now };
        db.Set<FinanceTaxPolicy>().Add(policy); var line = TaxLine(draft.Id, 1, "QA", 100); line.ComputedAmount = 100;
        db.PreinvoiceLines.Add(line); await db.SaveChangesAsync(ct);
        await FinanceTaxSnapshotWriter.ApplyOnceAsync(db, draft, [line], now, ct); await db.SaveChangesAsync(ct);
        var edit = scope.ServiceProvider.GetRequiredService<IPreinvoiceLineEditStore>();
        Assert.True((await edit.EditLineAsync(FinanceAccount, draft.PublicId, line.PublicId, new(60, false, "Synthetic gross correction", Convert.ToBase64String(draft.RowVersion)), ct)).IsSuccess);
        db.ChangeTracker.Clear(); draft = await db.Preinvoices.SingleAsync(p => p.PublicId == draft.PublicId, ct);
        line = await db.PreinvoiceLines.SingleAsync(l => l.PublicId == line.PublicId, ct);
        Assert.Equal(50, line.NetAmount); Assert.Equal(10, line.TaxAmount); Assert.Equal(60, draft.Total);
        FinanceTaxSnapshotWriter.RestoreComputed([line]); draft.Total = line.Amount; draft.Status = PreinvoiceStatus.Accepted; await db.SaveChangesAsync(ct);
        var issues = scope.ServiceProvider.GetRequiredService<IFinanceInvoiceIssueStore>(); var command = new IssueFinanceInvoiceCommand(FinanceAccount, draft.PublicId, Guid.NewGuid());
        var issued = await issues.IssueAsync(command, ct); Assert.True(issued.IsSuccess, issued.Failure?.ToString());
        db.ChangeTracker.Clear(); var invoice = await db.NonFiscalInvoices.SingleAsync(i => i.PublicId == issued.InvoiceId, ct);
        var frozen = await db.NonFiscalInvoiceLines.SingleAsync(l => l.InvoiceId == invoice.Id, ct);
        Assert.Equal(100, invoice.NetTotal); Assert.Equal(20, invoice.TaxTotal); Assert.Equal(120, invoice.Total);
        Assert.True(FinanceTaxSnapshotWriter.HasConfiguredIssuedTreatments(invoice, [frozen]));
        var commercial = invoice.CommercialSnapshotJson;
        var customer = await db.Organizations.SingleAsync(o => o.Id == airline.OrganizationId, ct); customer.LegalName = "Changed synthetic customer";
        await db.SaveChangesAsync(ct);
        Assert.True((await issues.IssueAsync(command, ct)).Replayed);
        db.ChangeTracker.Clear(); invoice = await db.NonFiscalInvoices.SingleAsync(i => i.PublicId == issued.InvoiceId, ct);
        Assert.Equal(commercial, invoice.CommercialSnapshotJson); Assert.DoesNotContain("Changed synthetic customer", commercial!, StringComparison.Ordinal);
        invoice.TaxTotal = 99; await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync(ct));
    }

    private static PreinvoiceLine TaxLine(long draft, int number, string code, decimal net) => new()
    {
        PublicId = Guid.NewGuid(), PreinvoiceId = draft, LineNumber = number, Kind = PreinvoiceLineKind.Adjustment,
        OperationCode = "TAX-QA", OperationDate = new(2026, 10, 18), ServiceCode = code, ServiceName = "Synthetic tax adjustment",
        AdjustmentReason = "Synthetic verification", ExecutedQuantity = 1, BillingUnit = "unit", UnitPrice = Math.Abs(net),
        CurrencyCode = "USD", Amount = net, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
    };
    private sealed class TaxTestActors(Guid station) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult<ActorContext?>(id != FinanceAccount ? null :
            new(id, "synthetic@test.invalid", "Finance", [], [new(Guid.NewGuid(), Guid.NewGuid(), "QA", "QA", OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new(station, "PUJ")], new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance, new HashSet<string>(["finance.taxes.read", "finance.taxes.create", "finance.taxes.update"]))));
    }

}
