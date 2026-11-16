using Elevant.Application.Common;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;
internal static class FinanceTreasuryBalances
{
    internal sealed record Totals(decimal Applied, decimal Credited, decimal Debited);
    public static async Task<Dictionary<long, Totals>> TotalsAsync(ElevantDbContext context, long[] invoiceIds,
        CancellationToken ct, DateOnly? asOf = null)
    {
        var movements = context.Set<FinanceTreasuryMovement>().AsNoTracking().Where(m => m.InvoiceId != null && invoiceIds.Contains(m.InvoiceId.Value));
        var notes = context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().Where(n => invoiceIds.Contains(n.InvoiceId));
        if (asOf is { } day)
        {
            // 4-N10: what was recorded until the end of the business day in Santo Domingo.
            var end = BusinessCalendar.StartOfDay(day.AddDays(1));
            movements = movements.Where(m => m.EffectiveOn <= day && m.CreatedAt < end);
            notes = notes.Where(n => n.EffectiveOn <= day && n.CreatedAt < end);
        }
        var applied = await movements.GroupBy(m => m.InvoiceId!.Value).Select(g => new { Id = g.Key,
            Amount = g.Sum(m => m.Kind == FinanceTreasuryMovementKind.Application ? m.InvoiceAmount :
                m.Kind == FinanceTreasuryMovementKind.ApplicationReversal ? -m.InvoiceAmount : 0m) }).ToDictionaryAsync(x => x.Id, x => x.Amount, ct);
        var adjustments = await notes.GroupBy(n => n.InvoiceId).Select(g => new { Id = g.Key,
            Credit = g.Sum(n => n.Kind == FinanceTreasuryAdjustmentKind.Credit ? n.Amount : 0m),
            Debit = g.Sum(n => n.Kind == FinanceTreasuryAdjustmentKind.Debit ? n.Amount : 0m) }).ToArrayAsync(ct);
        var byId = adjustments.ToDictionary(x => x.Id);
        return invoiceIds.Distinct().ToDictionary(id => id, id => new Totals(applied.GetValueOrDefault(id),
            byId.GetValueOrDefault(id)?.Credit ?? 0m, byId.GetValueOrDefault(id)?.Debit ?? 0m));
    }
    public static async Task<decimal> BalanceAsync(ElevantDbContext context, long invoiceId, decimal total, CancellationToken ct)
    {
        var paid = await context.NonFiscalPayments.Where(p => p.InvoiceId == invoiceId).SumAsync(p => (decimal?)p.Amount, ct) ?? 0m;
        var credited = await context.NonFiscalCreditNotes.Where(p => p.InvoiceId == invoiceId).SumAsync(p => (decimal?)p.Amount, ct) ?? 0m;
        var totals = (await TotalsAsync(context, [invoiceId], ct))[invoiceId];
        return FinanceTreasuryRules.Balance(total, paid, credited, totals.Applied, totals.Credited, totals.Debited);
    }
}
