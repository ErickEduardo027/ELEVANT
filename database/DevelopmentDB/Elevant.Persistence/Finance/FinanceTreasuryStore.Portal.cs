using System.Data;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;
internal sealed partial class FinanceTreasuryStore
{
    private sealed record PortalScope(ActorContext Actor, long AirlineKey, Guid AirlineId, ActorStationScope[] Stations);
    private async Task<PortalScope?> PortalScopeAsync(Guid actorId, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(actorId, ct);
        var organizationId = FinanceTreasuryPortalAccess.OrganizationId(actor, actorId);
        if (organizationId is null) return null;
        var airline = await (from a in context.Airlines.AsNoTracking()
            join o in context.Organizations.AsNoTracking() on a.OrganizationId equals o.Id
            where o.PublicId == organizationId && o.Type == OrganizationType.AirlineCustomer &&
                o.Status == OrganizationStatus.Active && a.IsActive select new { a.Id, a.PublicId }).SingleOrDefaultAsync(ct);
        if (airline is null) return null;
        // Finance history remains available after a contractual term ends; draft coverage never grants access.
        var stations = await (from contract in context.Contracts.AsNoTracking()
            join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
            join link in context.Set<ContractVersionStation>().AsNoTracking() on version.Id equals link.ContractVersionId
            join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
            where contract.AirlineId == airline.Id && station.IsActive &&
                (version.Status == ContractVersionStatus.Approved || version.Status == ContractVersionStatus.Superseded)
            select new { station.PublicId, station.Code }).Distinct().OrderBy(s => s.Code).ToArrayAsync(ct);
        var scopes = stations.Select(s => new ActorStationScope(s.PublicId, s.Code)).ToArray();
        return new(actor! with { StationScopes = scopes }, airline.Id, airline.PublicId, scopes);
    }
    private async Task<AirlineTreasuryReadResult<T>> PortalReadAsync<T>(Guid actorId,
        Func<PortalScope, Task<T?>> read, CancellationToken ct) where T : class
    {
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var scope = await PortalScopeAsync(actorId, ct);
            if (scope is null) return new AirlineTreasuryReadResult<T>(null, FinanceTreasuryFailure.Forbidden);
            var data = await read(scope);
            await tx.CommitAsync(ct);
            return new AirlineTreasuryReadResult<T>(data, data is null ? FinanceTreasuryFailure.NotFound : null);
        });
    }
    private IQueryable<InvoiceScope> PortalInvoices(PortalScope scope) =>
        Invoices(scope.Actor).AsNoTracking().Where(i => i.Invoice.AirlineId == scope.AirlineKey);
    private IQueryable<ReceiptScope> PortalReceipts(PortalScope scope) =>
        Receipts(scope.Actor).AsNoTracking().Where(r => r.Receipt.AirlineId == scope.AirlineKey);
    private static AirlineTreasuryMovementData PortalMovement(FinanceTreasuryStatementMovementData m) =>
        new(m.Id, m.ReceiptId, m.InvoiceId, m.Kind, m.CurrencyCode, m.Amount, m.EffectiveOn, m.RecordedAt, m.ReversesId, m.Reference);
    private static AirlineTreasuryAdjustmentData PortalNote(FinanceTreasuryAdjustmentData n) =>
        new(n.Id, n.Number, n.InvoiceId, n.RelatedNoteId, n.Kind, n.CurrencyCode, n.Amount, n.EffectiveOn, n.Reason, n.RecordedAt,
            n.Lines.Select(l => new AirlineTreasuryAdjustmentLineData(l.InvoiceLineId, l.Quantity, l.Amount)).ToArray());
    private static AirlineTreasuryReceiptData PortalReceipt(FinanceTreasuryReceiptData r, PortalScope scope) =>
        new(r.Id, r.StationId, scope.Stations.Single(s => s.StationId == r.StationId).StationCode, r.Reference, r.CurrencyCode,
            r.Amount, r.Applied, r.Refunded, r.Available, r.Reversed, r.Method, r.ReceivedOn,
            r.Movements.Select(m => new AirlineTreasuryReceiptMovementData(m.Id, m.Kind, m.InvoiceId, m.ReversesId,
                m.EffectiveOn, m.ReceiptAmount, m.InvoiceAmount, m.ReceiptCurrency, m.InvoiceCurrency, m.ExchangeRate,
                m.ExchangeRateOn, m.Reference, m.Reason, m.RecordedAt)).ToArray());
    private static AirlineTreasuryInvoiceData PortalInvoice(FinanceTreasuryStatementInvoiceData i, Guid preinvoiceId, PortalScope scope) =>
        new(i.Id, preinvoiceId, i.Number, i.StationId, scope.Stations.Single(s => s.StationId == i.StationId).StationCode,
            i.CurrencyCode, i.Total, i.LegacyPaid, i.LegacyCredited, i.Applied, i.Credited, i.Debited, i.Balance,
            i.DueDate, i.DaysOverdue, i.AgingBucket);
    public Task<AirlineTreasuryReadResult<AirlineTreasuryStatementData>> PortalStatementAsync(Guid actorId, DateOnly asOf,
        Guid? stationId, CancellationToken cancellationToken = default)
    {
        if (!DateValid(asOf)) return Task.FromResult(new AirlineTreasuryReadResult<AirlineTreasuryStatementData>(null, FinanceTreasuryFailure.Invalid));
        var ct = cancellationToken;
        return PortalReadAsync<AirlineTreasuryStatementData>(actorId, async scope =>
        {
            if (stationId is { } station && !scope.Stations.Any(s => s.StationId == station)) return null;
            var data = await StatementDataAsync(scope.Actor, asOf, stationId, scope.AirlineId, ct);
            var ids = data.Invoices.Select(i => i.Id).ToArray();
            var preinvoices = await (from i in PortalInvoices(scope) join p in context.Preinvoices.AsNoTracking() on i.Invoice.PreinvoiceId equals p.Id
                where ids.Contains(i.Invoice.PublicId) select new { i.Invoice.PublicId, PreinvoiceId = p.PublicId }).ToDictionaryAsync(i => i.PublicId, i => i.PreinvoiceId, ct);
            var allowedInvoiceIds = await PortalInvoices(scope).Select(i => i.Invoice.PublicId).ToArrayAsync(ct);
            if (data.Receipts.Any(r => r.Movements.Any(m => m.InvoiceId is { } invoiceId && !allowedInvoiceIds.Contains(invoiceId)))) return null;
            return new(scope.AirlineId, asOf, data.Invoices.Select(i => PortalInvoice(i, preinvoices[i.Id], scope)).ToArray(),
                data.Receipts.Select(r => PortalReceipt(r, scope)).ToArray(), data.Movements.Select(PortalMovement).ToArray(),
                data.Aging.Select(a => new AirlineTreasuryAgingData(a.CurrencyCode, a.Balance, a.Current, a.Days1To30,
                    a.Days31To60, a.Days61To90, a.Days91Plus, a.Unallocated, a.CreditBalance)).ToArray());
        }, ct);
    }
    public Task<AirlineTreasuryReadResult<AirlineTreasuryInvoiceDetailData>> PortalInvoiceAsync(Guid actorId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        var ct = cancellationToken;
        return PortalReadAsync<AirlineTreasuryInvoiceDetailData>(actorId, async scope =>
        {
            var row = await PortalInvoices(scope).SingleOrDefaultAsync(i => i.Invoice.PublicId == invoiceId, ct);
            if (row is null) return null;
            var statement = await StatementDataAsync(scope.Actor, Today, row.StationId, scope.AirlineId, ct);
            var summary = statement.Invoices.SingleOrDefault(i => i.Id == invoiceId);
            if (summary is null) return null;
            var preinvoiceId = await context.Preinvoices.AsNoTracking().Where(p => p.Id == row.Invoice.PreinvoiceId).Select(p => p.PublicId).SingleAsync(ct);
            var lines = await context.Set<NonFiscalInvoiceLine>().AsNoTracking().Where(l => l.InvoiceId == row.Invoice.Id).OrderBy(l => l.LineNumber)
                .Select(l => new AirlineTreasuryInvoiceLineData(l.PublicId, l.LineNumber, l.Kind.ToString(), l.ParentLineNumber, l.OperationCode,
                    l.OperationDate, l.ServiceCode, l.ServiceName, l.ExecutedQuantity, l.BillingUnit, l.UnitPrice, l.Amount, l.Reason)).ToArrayAsync(ct);
            var notes = await AdjustmentDataAsync(row.Invoice, ct);
            return new(PortalInvoice(summary, preinvoiceId, scope), lines,
                statement.Movements.Where(m => m.InvoiceId == invoiceId).Select(PortalMovement).ToArray(), notes.Notes.Select(PortalNote).ToArray());
        }, ct);
    }
    public Task<AirlineTreasuryReadResult<AirlineTreasuryReceiptData>> PortalReceiptAsync(Guid actorId, Guid receiptId,
        CancellationToken cancellationToken = default)
    {
        var ct = cancellationToken;
        return PortalReadAsync<AirlineTreasuryReceiptData>(actorId, async scope =>
        {
            var row = await PortalReceipts(scope).SingleOrDefaultAsync(r => r.Receipt.PublicId == receiptId, ct);
            if (row is null) return null;
            var data = await ReceiptDataAsync(row, null, ct);
            var invoiceIds = await PortalInvoices(scope).Select(i => i.Invoice.PublicId).ToArrayAsync(ct);
            if (data.Movements.Any(m => m.InvoiceId is { } invoiceId && !invoiceIds.Contains(invoiceId))) return null;
            return PortalReceipt(data, scope);
        }, ct);
    }
    public Task<AirlineTreasuryReadResult<AirlineTreasuryAdjustmentsData>> PortalAdjustmentsAsync(Guid actorId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        var ct = cancellationToken;
        return PortalReadAsync<AirlineTreasuryAdjustmentsData>(actorId, async scope =>
        {
            var row = await PortalInvoices(scope).SingleOrDefaultAsync(i => i.Invoice.PublicId == invoiceId, ct);
            if (row is null) return null;
            var data = await AdjustmentDataAsync(row.Invoice, ct);
            return new(invoiceId, row.Invoice.Number, row.Invoice.CurrencyCode, data.LegacyCredited, data.Notes.Select(PortalNote).ToArray());
        }, ct);
    }
}
