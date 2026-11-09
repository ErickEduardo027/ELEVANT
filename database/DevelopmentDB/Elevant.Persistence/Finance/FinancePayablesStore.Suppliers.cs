using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    public Task<FinancePayablesResult<IReadOnlyList<SupplierView>>> ListSuppliersAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) =>
        ReadAsync<IReadOnlyList<SupplierView>>(actorId, "finance.suppliers.read", async a =>
        {
            Filter(filter); var station = await FilterStationAsync(a, filter, ct);
            var query = context.Set<Supplier>().AsNoTracking().Where(x => a.Stations.Contains(x.ScopeStationId));
            if (station is not null) query = query.Where(x => x.ScopeStationId == station);
            if (filter.SupplierId is { } id) query = query.Where(x => x.PublicId == id);
            if (filter.Status is { } status) { Require(status is "Active" or "Inactive"); query = query.Where(x => x.IsActive == (status == "Active")); }
            if (!string.IsNullOrWhiteSpace(filter.Search)) query = query.Where(x => x.Code.Contains(filter.Search) || x.Name.Contains(filter.Search));
            var rows = await query.OrderBy(x => x.Name).ThenBy(x => x.Id).Skip(filter.Skip).Take(filter.Take).ToArrayAsync(ct);
            var result = new List<SupplierView>(); foreach (var row in rows) result.Add(await SupplierViewAsync(row, ct)); return result;
        }, ct);
    public Task<FinancePayablesResult<SupplierView>> GetSupplierAsync(Guid actorId, Guid id, CancellationToken ct = default) =>
        ReadAsync(actorId, "finance.suppliers.read", async a => await SupplierViewAsync(await SupplierAsync(a, id, ct), ct), ct);
    private async Task<Supplier> SupplierAsync(Actor a, Guid id, CancellationToken ct)
    {
        var row = await context.Set<Supplier>().SingleOrDefaultAsync(x => x.PublicId == id, ct);
        Require(row is not null, "not_found"); Scope(a, row!.ScopeStationId); return row;
    }
    private async Task<SupplierView> SupplierViewAsync(Supplier row, CancellationToken ct) => new(row.PublicId,
        (await PublicAsync<Elevant.Domain.Entities.Reference.Station>(row.ScopeStationId, ct))!.Value, row.Code, row.Name,
        row.TaxReference, row.ContactEmail, row.IsActive, Version(row.RowVersion));
    public Task<FinancePayablesResult<FinancePayablesMutation>> SaveSupplierAsync(Guid actorId, Guid? id, SupplierSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "supplier.save", id, input, id is null ? "finance.suppliers.create" : "finance.suppliers.update", async a =>
        {
            Require(Finance(a, id is null ? "finance.suppliers.create" : "finance.suppliers.update"), "forbidden");
            Require(Text(input.Code, 40) && Text(input.Name, 200) && OptionalText(input.TaxReference, 80) && OptionalText(input.ContactEmail, 254));
            if (!string.IsNullOrEmpty(input.ContactEmail)) Require(System.Net.Mail.MailAddress.TryCreate(input.ContactEmail.Trim(), out _));
            var station = await StationAsync(a, input.ScopeStationId, ct); var now = clock.GetUtcNow();
            var row = id is { } key ? await SupplierAsync(a, key, ct) : new Supplier { PublicId = Guid.CreateVersion7(), CreatedAt = now, CreatedByAccountId = a.Id, ScopeStationId = station };
            if (id is not null) { Match(row.RowVersion, input.ExpectedVersion); Require(row.ScopeStationId == station); }
            else context.Set<Supplier>().Add(row);
            var code = input.Code.Trim().ToUpperInvariant();
            Require(!await context.Set<Supplier>().AnyAsync(s => s.ScopeStationId == station && s.Code == code && s.Id != row.Id, ct),
                FinancePayablesProblems.DuplicateSupplierCode);
            // 4-N15: unticking «Proveedor activo» is a retirement too, with the same rule.
            if (id is not null && row.IsActive && !input.IsActive)
                Require(!await SupplierHasOpenBalanceAsync(row.Id, ct), FinancePayablesProblems.SupplierHasOpenBalance);
            row.Code = code; row.Name = input.Name.Trim(); row.TaxReference = input.TaxReference?.Trim();
            row.ContactEmail = input.ContactEmail?.Trim(); row.IsActive = input.IsActive; row.UpdatedAt = now;
            Audit(a, id is null ? "finance.supplier.created" : "finance.supplier.updated", "commercial.suppliers", row.PublicId); return row.PublicId;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> DeleteSupplierAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "supplier.retire", id, input, "finance.suppliers.delete", async a =>
        {
            Require(Finance(a, "finance.suppliers.delete"), "forbidden"); var row = await SupplierAsync(a, id, ct);
            Match(row.RowVersion, input.ExpectedVersion); RequireReason(input.Reason, true);
            Require(!await SupplierHasOpenBalanceAsync(row.Id, ct), FinancePayablesProblems.SupplierHasOpenBalance);
            row.IsActive = false; row.UpdatedAt = clock.GetUtcNow(); Audit(a, "finance.supplier.retired", "commercial.suppliers", id, input.Reason); return id;
        }, ct);
    /// <summary>
    /// 4-N15: a supplier keeps working while it has an invoice in Draft or under review, an approved invoice with a balance
    /// or a payment not voided with something left to apply (reversed applications do not count). Its retirement waits
    /// until those are voided or settled, so its invoices never get stuck.
    /// </summary>
    private async Task<bool> SupplierHasOpenBalanceAsync(long supplierId, CancellationToken ct)
    {
        var invoices = context.Set<SupplierInvoice>().Where(x => x.SupplierId == supplierId);
        if (await invoices.AnyAsync(x => x.Status == SupplierInvoiceStatus.Draft || x.Status == SupplierInvoiceStatus.Submitted, ct)) return true;
        var applications = ActiveApplications();
        if (await invoices.AnyAsync(x => x.Status == SupplierInvoiceStatus.Approved &&
                x.Total > (applications.Where(p => p.SupplierInvoiceId == x.Id).Sum(p => (decimal?)p.InvoiceAmount) ?? 0), ct)) return true;
        var voids = PaymentVoids();
        return await context.Set<FinancePayablesPayment>().AnyAsync(x => x.SupplierId == supplierId && !voids.Any(v => v.PaymentId == x.Id) &&
            x.Amount > (applications.Where(p => p.PaymentId == x.Id).Sum(p => (decimal?)p.PaymentAmount) ?? 0), ct);
    }
}
