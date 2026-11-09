using Elevant.Application.Common;
using System.Data;
using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;
internal sealed partial class FinanceTreasuryStore
{
    public async Task<FinanceTreasuryOptionsData?> OptionsAsync(Guid actorId, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "finance.receipts.read", cancellationToken);
        if (actor is null) return null;
        var ids = actor.StationScopes.Select(s => s.StationId).ToArray();
        var stations = await context.Stations.AsNoTracking().Where(s => ids.Contains(s.PublicId) && s.IsActive)
            .OrderBy(s => s.Code).Select(s => new FinanceTreasuryStationOptionData(s.PublicId, s.Code)).ToArrayAsync(cancellationToken);
        if (stations.Length == 0) return new([], []);
        var airlines = await (from a in context.Airlines.AsNoTracking() join o in context.Organizations.AsNoTracking() on a.OrganizationId equals o.Id
            where a.IsActive && o.Status == OrganizationStatus.Active && o.Type == OrganizationType.AirlineCustomer orderby a.Name
            select new FinanceTreasuryAirlineOptionData(a.PublicId, a.Name)).ToArrayAsync(cancellationToken);
        return new(airlines, stations);
    }
    public async Task<FinanceTreasuryReceiptPageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId,
        int page, int limit, CancellationToken cancellationToken = default)
    {
        if (page < 1 || page > 1_000_000 || limit is < 1 or > 100) return null;
        var actor = await ActorAsync(actorId, "finance.receipts.read", cancellationToken);
        if (actor is null || stationId is { } station && !actor.StationScopes.Any(s => s.StationId == station)) return null;
        var rows = await Receipts(actor).AsNoTracking().Where(r => (stationId == null || r.StationId == stationId) &&
            (airlineId == null || r.AirlineId == airlineId)).OrderByDescending(r => r.Receipt.CreatedAt).ThenByDescending(r => r.Receipt.Id)
            .Skip((page - 1) * limit).Take(limit + 1).ToArrayAsync(cancellationToken);
        var items = new List<FinanceTreasuryReceiptData>();
        foreach (var row in rows.Take(limit)) items.Add(await ReceiptDataAsync(row, null, cancellationToken));
        return new(page, limit, rows.Length > limit, items);
    }
    public async Task<FinanceTreasuryReceiptData?> GetAsync(Guid actorId, Guid receiptId, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "finance.receipts.read", cancellationToken);
        if (actor is null) return null;
        var row = await Receipts(actor).AsNoTracking().SingleOrDefaultAsync(r => r.Receipt.PublicId == receiptId, cancellationToken);
        return row is null ? null : await ReceiptDataAsync(row, null, cancellationToken);
    }
    private async Task<FinanceTreasuryReceiptData> ReceiptDataAsync(ReceiptScope scope, DateOnly? asOf, CancellationToken ct)
    {
        var receipt = scope.Receipt;
        var query = context.Set<FinanceTreasuryMovement>().AsNoTracking().Where(m => m.ReceiptId == receipt.Id);
        if (asOf is { } day)
        {
            var end = EndOfDay(day);
            query = query.Where(m => m.EffectiveOn <= day && m.CreatedAt < end);
        }
        var moves = await query.OrderBy(m => m.CreatedAt).ThenBy(m => m.Id).ToArrayAsync(ct);
        var invoices = moves.Where(m => m.InvoiceId != null).Select(m => m.InvoiceId!.Value).ToArray();
        var invoiceIds = await context.NonFiscalInvoices.AsNoTracking().Where(i => invoices.Contains(i.Id)).ToDictionaryAsync(i => i.Id, i => i.PublicId, ct);
        var accountIds = moves.Select(m => m.ActorAccountId).Append(receipt.ActorAccountId).ToArray();
        var actorsById = await context.Users.AsNoTracking().Where(u => accountIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.PublicId, ct);
        var applied = Applied(moves); var refunded = moves.Where(m => m.Kind == FinanceTreasuryMovementKind.Refund).Sum(m => m.ReceiptAmount);
        var reversed = moves.Any(m => m.Kind == FinanceTreasuryMovementKind.ReceiptReversal);
        return new(receipt.PublicId, scope.AirlineId, scope.StationId, receipt.CurrencyCode, receipt.Amount, receipt.Reference,
            receipt.Method.ToString(), receipt.ReceivedOn, applied, refunded, FinanceTreasuryRules.Available(receipt.Amount, applied, refunded, reversed),
            reversed, receipt.Reason, actorsById[receipt.ActorAccountId], receipt.CreatedAt, Version(receipt), moves.Select(m =>
                new FinanceTreasuryMovementData(m.PublicId, m.Kind.ToString(), m.InvoiceId is { } invoice ? invoiceIds[invoice] : null,
                    m.ReversesMovementId is { } original ? moves.Single(p => p.Id == original).PublicId : null,
                    m.EffectiveOn, m.ReceiptAmount, m.InvoiceAmount, m.ReceiptCurrency, m.InvoiceCurrency, m.ExchangeRate,
                    m.ExchangeRateOn, m.Reference, m.Reason, actorsById[m.ActorAccountId], m.CreatedAt)).ToArray());
    }
    public async Task<FinanceTreasuryStatementData?> StatementAsync(Guid actorId, DateOnly asOf, Guid? stationId, Guid? airlineId,
        CancellationToken cancellationToken = default)
    {
        if (!DateValid(asOf) || asOf == DateOnly.MaxValue) return null;
        var ct = cancellationToken;
        return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            var actor = await ActorAsync(actorId, "finance.receipts.read", ct);
            if (actor is null || stationId is { } only && !actor.StationScopes.Any(s => s.StationId == only)) return null;
            var result = await StatementDataAsync(actor, asOf, stationId, airlineId, ct);
            await tx.CommitAsync(ct); return result;
        });
    }
    private async Task<FinanceTreasuryStatementData> StatementDataAsync(Elevant.Application.Identity.ActorContext actor,
        DateOnly asOf, Guid? stationId, Guid? airlineId, CancellationToken ct)
    {
        var end = EndOfDay(asOf);
        var rows = await Invoices(actor).AsNoTracking().Where(i => i.Invoice.CreatedAt < end &&
            (stationId == null || i.StationId == stationId) && (airlineId == null || i.AirlineId == airlineId)).OrderBy(i => i.Invoice.Id).ToArrayAsync(ct);
        var ids = rows.Select(i => i.Invoice.Id).ToArray();
        var payments = await context.NonFiscalPayments.AsNoTracking().Where(p => ids.Contains(p.InvoiceId) && p.CreatedAt < end &&
            (p.PaidOn == null || p.PaidOn <= asOf)).ToArrayAsync(ct);
        var legacyNotes = await context.NonFiscalCreditNotes.AsNoTracking().Where(n => ids.Contains(n.InvoiceId) && n.CreatedAt < end).ToArrayAsync(ct);
        var totals = await FinanceTreasuryBalances.TotalsAsync(context, ids, ct, asOf);
        var accounts = await context.Set<FinanceTreasuryInvoiceAccount>().AsNoTracking().Where(a => ids.Contains(a.InvoiceId)).ToDictionaryAsync(a => a.InvoiceId, ct);
        var invoices = rows.Select(row => {
            var i = row.Invoice; var t = totals[i.Id];
            var paid = payments.Where(p => p.InvoiceId == i.Id).Sum(p => p.Amount);
            var credited = legacyNotes.Where(n => n.InvoiceId == i.Id).Sum(n => n.Amount);
            var balance = FinanceTreasuryRules.Balance(i.Total, paid, credited, t.Applied, t.Credited, t.Debited);
            var days = balance > 0m && i.DueDate is { } due ? Math.Max(0, asOf.DayNumber - due.DayNumber) : 0;
            return new FinanceTreasuryStatementInvoiceData(i.PublicId, i.Number, row.AirlineId, row.StationId, i.CurrencyCode,
                i.Total, paid, credited, t.Applied, t.Credited, t.Debited, balance, i.DueDate, days, FinanceTreasuryRules.AgingBucket(days),
                Version(accounts.GetValueOrDefault(i.Id)), i.FiscalNumber); }).ToArray();
        var receiptRows = await Receipts(actor).AsNoTracking().Where(r => r.Receipt.CreatedAt < end && r.Receipt.ReceivedOn <= asOf &&
            (stationId == null || r.StationId == stationId) && (airlineId == null || r.AirlineId == airlineId)).OrderBy(r => r.Receipt.Id).ToArrayAsync(ct);
        var receipts = new List<FinanceTreasuryReceiptData>();
        foreach (var row in receiptRows) receipts.Add(await ReceiptDataAsync(row, asOf, ct));
        var movements = new List<FinanceTreasuryStatementMovementData>();
        foreach (var r in receipts)
        {
            movements.Add(new(r.Id, r.Id, null, "Receipt", r.CurrencyCode, r.Amount, r.ReceivedOn, r.RecordedAt, null, r.Reference));
            movements.AddRange(r.Movements.Select(m => new FinanceTreasuryStatementMovementData(m.Id, r.Id, m.InvoiceId,
                m.Kind, m.ReceiptCurrency, m.ReceiptAmount, m.EffectiveOn, m.RecordedAt, m.ReversesId, m.Reference)));
        }
        foreach (var row in rows)
        {
            var invoice = row.Invoice;
            // 4-N19: the e-NCF is how Finance and the airline name the invoice; the internal number before ADR-0035.
            movements.Add(new(invoice.PublicId, null, invoice.PublicId, "Invoice", invoice.CurrencyCode, invoice.Total,
                BusinessCalendar.Today(invoice.CreatedAt), invoice.CreatedAt, null, invoice.FiscalNumber ?? invoice.Number));
            movements.AddRange(payments.Where(p => p.InvoiceId == invoice.Id).Select(p => new FinanceTreasuryStatementMovementData(p.PublicId,
                null, invoice.PublicId, "LegacyPayment", p.CurrencyCode, p.Amount, p.PaidOn ?? BusinessCalendar.Today(p.CreatedAt), p.CreatedAt, null, p.Reference)));
            movements.AddRange(legacyNotes.Where(n => n.InvoiceId == invoice.Id).Select(n => new FinanceTreasuryStatementMovementData(n.PublicId,
                null, invoice.PublicId, "LegacyCredit", n.CurrencyCode, n.Amount, BusinessCalendar.Today(n.CreatedAt), n.CreatedAt, null, n.Number)));
        }
        var notes = await context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().Where(n => ids.Contains(n.InvoiceId) && n.EffectiveOn <= asOf && n.CreatedAt < end).ToArrayAsync(ct);
        movements.AddRange(notes.Select(n => new FinanceTreasuryStatementMovementData(n.PublicId, null, rows.Single(r => r.Invoice.Id == n.InvoiceId).Invoice.PublicId,
            n.Kind.ToString(), n.CurrencyCode, n.Amount, n.EffectiveOn, n.CreatedAt,
            n.RelatedNoteId is { } related ? context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().Where(p => p.Id == related).Select(p => (Guid?)p.PublicId).Single() : null, n.Number)));
        var aging = invoices.Select(i => i.CurrencyCode).Concat(receipts.Select(r => r.CurrencyCode)).Distinct().Order(StringComparer.Ordinal).Select(currency => {
            var group = invoices.Where(i => i.CurrencyCode == currency).ToArray();
            decimal Bucket(string bucket) => group.Where(i => i.AgingBucket == bucket).Sum(i => Math.Max(0, i.Balance));
            return new FinanceTreasuryAgingData(currency, group.Sum(i => i.Balance), Bucket("Current"), Bucket("1-30"), Bucket("31-60"), Bucket("61-90"), Bucket("91+"),
                receipts.Where(r => r.CurrencyCode == currency).Sum(r => r.Available), -group.Where(i => i.Balance < 0m).Sum(i => i.Balance)); }).ToArray();
        return new(asOf, invoices, receipts, movements.OrderBy(m => m.EffectiveOn).ThenBy(m => m.RecordedAt).ThenBy(m => m.Id).ToArray(), aging);
    }
}
