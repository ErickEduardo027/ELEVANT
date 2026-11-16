using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

public static class FinanceTaxSnapshotWriter
{
    public static async Task<FinanceTaxPolicy?> ResolveAsync(ElevantDbContext context, Preinvoice draft,
        PreinvoiceLine line, CancellationToken ct = default)
    {
        var policies = await context.Set<FinanceTaxPolicy>().AsNoTracking().Where(p => p.AirlineId == draft.AirlineId &&
            p.StationId == draft.StationId && p.CurrencyCode == draft.CurrencyCode && p.Status == FinanceTaxPolicyStatus.Published).ToArrayAsync(ct);
        return FinanceTaxCalculator.Resolve(policies, draft.AirlineId, draft.StationId, line);
    }
    /// <summary>Call inside the caller's serializable transaction after package/charge assembly, before final SaveChanges.
    /// ComputedAmount remains the pretax computed value. No implicit treatment is invented.</summary>
    public static async Task ApplyOnceAsync(ElevantDbContext context, Preinvoice draft,
        IReadOnlyList<PreinvoiceLine> lines, DateTimeOffset now, CancellationToken ct = default,
        bool configureMissing = false)
    {
        var policies = await context.Set<FinanceTaxPolicy>().AsNoTracking().Where(p =>
            p.AirlineId == draft.AirlineId && p.StationId == draft.StationId &&
            p.CurrencyCode == draft.CurrencyCode && p.Status == FinanceTaxPolicyStatus.Published).ToArrayAsync(ct);
        // Resolve all before writing any line so ambiguity does not partially mutate an aggregate.
        var selections = lines.Select(line => FinanceTaxCalculator.Resolve(policies, draft.AirlineId, draft.StationId, line)).ToArray();
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            if (configureMissing && line.TaxTreatment == FinanceTaxTreatment.Unconfigured && selections[i] is not null)
                line.TaxCapturedAt = null;
            FinanceTaxCalculator.Capture(line, selections[i], now);
        }
        draft.Total = lines.Where(l => !l.IsExcluded).Sum(l => l.Amount);
    }

    /// <summary>After restoring computed exclusions/quantities, call before summing Amount. Never resolves current policies.</summary>
    public static void RestoreComputed(IReadOnlyList<PreinvoiceLine> lines)
    {
        foreach (var line in lines) FinanceTaxCalculator.RestoreComputed(line);
    }

    /// <summary>Fiscal preparation must call this on issued frozen data before creating a fiscal document.</summary>
    public static bool HasConfiguredIssuedTreatments(NonFiscalInvoice invoice, IReadOnlyList<NonFiscalInvoiceLine> lines) =>
        invoice.TaxTreatmentsConfigured && invoice.CommercialSnapshotJson is not null && lines.Count > 0 &&
        lines.All(l => l.TaxCapturedAt is not null && l.TaxPolicyPublicId is not null &&
            l.TaxTreatment != FinanceTaxTreatment.Unconfigured && l.TaxAmount is not null &&
            l.NetAmount - l.DiscountAmount + l.TaxAmount == l.Amount && l.GrossAmount == l.Amount) &&
        lines.Sum(l => l.Amount) == invoice.Total && lines.Sum(l => l.TaxAmount) == invoice.TaxTotal;
}
