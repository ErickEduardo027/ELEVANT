using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    private async Task<SupplierInvoice> InvoiceAsync(Actor a, Guid id, CancellationToken ct)
    {
        var row = await context.Set<SupplierInvoice>().SingleOrDefaultAsync(x => x.PublicId == id, ct);
        Require(row is not null, "not_found"); Scope(a, row!.ScopeStationId); return row;
    }
    public Task<FinancePayablesResult<FinancePayablesView>> GetInvoiceAsync(Guid actorId, Guid id, CancellationToken ct = default) =>
        ReadAsync(actorId, "finance.payables.read", async a => await InvoiceViewAsync(await InvoiceAsync(a, id, ct), ct), ct);
    public Task<FinancePayablesResult<IReadOnlyList<FinancePayablesView>>> ListInvoicesAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) =>
        ReadAsync<IReadOnlyList<FinancePayablesView>>(actorId, "finance.payables.read", async a =>
        {
            Filter(filter); var station = await FilterStationAsync(a, filter, ct);
            var query = context.Set<SupplierInvoice>().AsNoTracking().Where(x => a.Stations.Contains(x.ScopeStationId));
            if (station is not null) query = query.Where(x => x.ScopeStationId == station);
            if (filter.SupplierId is { } supplier) query = query.Where(x => context.Set<Supplier>().Any(s => s.Id == x.SupplierId && s.PublicId == supplier));
            if (filter.Status is { } status) { Require(Enum.TryParse<SupplierInvoiceStatus>(status, out var parsed) && Enum.IsDefined(parsed)); query = query.Where(x => x.Status == parsed); }
            if (filter.From is { } from) query = query.Where(x => x.DocumentDate >= from);
            if (filter.To is { } to) query = query.Where(x => x.DocumentDate <= to);
            if (!string.IsNullOrWhiteSpace(filter.Search)) query = query.Where(x => x.DocumentReference.Contains(filter.Search));
            var applications = CurrentApplications();
            if (filter.OutstandingOnly) query = query.Where(x => x.Status == SupplierInvoiceStatus.Approved && x.Total > (applications.Where(p => p.SupplierInvoiceId == x.Id).Sum(p => (decimal?)p.InvoiceAmount) ?? 0));
            var rows = await query.OrderByDescending(x => x.DocumentDate).ThenBy(x => x.Id).Skip(filter.Skip).Take(filter.Take).ToArrayAsync(ct);
            var result = new List<FinancePayablesView>(); foreach (var row in rows) result.Add(await InvoiceViewAsync(row, ct)); return result;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> SaveInvoiceAsync(Guid actorId, Guid? id, FinancePayablesSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "payable.save", id, input, "finance.payables.manage", async a =>
        {
            Require(Finance(a, "finance.payables.manage"), "forbidden");
            Require(Text(input.DocumentReference, 100) && input.DueDate >= input.DocumentDate);
            var total = ValidateLines(input.Lines); var dop = ValidateFx(input.Fx, total, input.DocumentDate);
            var station = await StationAsync(a, input.ScopeStationId, ct); var supplier = await SupplierAsync(a, input.SupplierId, ct);
            Require(supplier.IsActive && supplier.ScopeStationId == station);
            var dims = await DimensionsAsync(a, station, input.Dimensions, ct); var now = clock.GetUtcNow();
            var row = id is { } key ? await InvoiceAsync(a, key, ct) : new SupplierInvoice { PublicId = Guid.CreateVersion7(), CreatedAt = now, CreatedByAccountId = a.Id, ScopeStationId = station };
            if (id is not null) { Match(row.RowVersion, input.ExpectedVersion); Require(row.Status == SupplierInvoiceStatus.Draft, "conflict"); Require(row.ScopeStationId == station); }
            else context.Set<SupplierInvoice>().Add(row);
            row.SupplierId = supplier.Id; row.DocumentReference = input.DocumentReference.Trim().ToUpperInvariant();
            row.DocumentDate = input.DocumentDate; row.DueDate = input.DueDate;
            row.CurrencyCode = input.Fx.Currency; row.FxToDop = input.Fx.RateToDop!.Value; row.FxSource = input.Fx.Source.Trim(); row.FxDate = input.Fx.RateDate!.Value;
            row.Total = total; row.TotalDop = dop; row.StationId = dims.Station; row.AirlineId = dims.Airline; row.TurnaroundId = dims.Turnaround; row.ServiceDefinitionId = dims.Service;
            row.UpdatedAt = now; await context.SaveChangesAsync(ct);
            context.Set<SupplierInvoiceLine>().RemoveRange(await context.Set<SupplierInvoiceLine>().Where(x => x.DocumentId == row.Id).ToArrayAsync(ct));
            await context.SaveChangesAsync(ct);
            context.Set<SupplierInvoiceLine>().AddRange(input.Lines.Select((l, i) => new SupplierInvoiceLine { PublicId = Guid.CreateVersion7(), DocumentId = row.Id,
                LineNumber = i + 1, Description = l.Description.Trim(), Quantity = l.Quantity, UnitPrice = l.UnitPrice, TaxAmount = l.TaxAmount,
                Total = FinancePayablesPolicy.LineTotal(l.Quantity, l.UnitPrice, l.TaxAmount) }));
            Audit(a, id is null ? "finance.payable.created" : "finance.payable.draft_updated", "commercial.supplier_invoices", row.PublicId); return row.PublicId;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> DecideInvoiceAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "payable.decide", id, input, input.Decision == "Submitted" ? "finance.payables.manage" : "finance.payables.approve", async a =>
        {
            Require(Finance(a, input.Decision == "Submitted" ? "finance.payables.manage" : "finance.payables.approve"), "forbidden");
            var row = await InvoiceAsync(a, id, ct); Match(row.RowVersion, input.ExpectedVersion);
            Require(OptionalText(input.Reason, 500) && FinancePayablesPolicy.CanTransitionInvoice(row.Status.ToString(), input.Decision, input.Reason), "conflict");
            Require(await context.Set<Supplier>().AnyAsync(s => s.Id == row.SupplierId && s.IsActive, ct), "conflict");
            row.Status = Enum.Parse<SupplierInvoiceStatus>(input.Decision); row.UpdatedAt = clock.GetUtcNow();
            context.Set<SupplierInvoiceReview>().Add(new SupplierInvoiceReview { DocumentId = row.Id, Stage = input.Decision == "Submitted" ? "Submission" : "Finance",
                Decision = input.Decision, Reason = input.Reason?.Trim(), ActorAccountId = a.Id, DecidedAt = clock.GetUtcNow() });
            Audit(a, "finance.payable." + input.Decision.ToLowerInvariant(), "commercial.supplier_invoices", id, input.Reason); return id;
        }, ct);
}
