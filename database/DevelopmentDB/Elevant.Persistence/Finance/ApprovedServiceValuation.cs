using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// The valuation of an approved service from what OCC approved (ADR-0034, 3-N11, 3-N29): the frozen evidence must
/// still match the live service (status, quantities, unit and charge marks), a charge its contract excludes blocks
/// it, and <see cref="FinanceApprovedServicePolicy"/> values the frozen price. «Servicios aprobados» and «Por
/// facturar» (4-N16) read services through it, so both say the same of each one.
/// </summary>
internal static class ApprovedServiceValuation
{
    /// <summary>A live service and the evidence its approval froze (<c>ApprovedEvidenceJson</c> or the hand-off).</summary>
    internal sealed record Source(long ServiceId, Guid ServicePublicId, string? EvidenceJson,
        ServiceExecutionStatus Status, decimal ContractedQuantity, decimal ExecutedQuantity, string BillingUnit,
        decimal? UnitPrice, string? Currency, bool BillingExcluded);

    /// <summary>The service with its frozen evidence, charges and timing, and what it is worth.</summary>
    internal sealed record Valued(Source Source, OccReviewServiceData? Evidence, IReadOnlyList<ServiceChargeEvidence> Charges,
        ServiceTimingEvidence? Timing, FinanceServiceValuation Valuation);

    public static async Task<IReadOnlyList<Valued>> ValueAsync(ElevantDbContext context, IReadOnlyList<Source> sources,
        CancellationToken cancellationToken)
    {
        if (sources.Count == 0) return [];
        var ids = sources.Select(source => source.ServiceId).Distinct().ToArray();
        var liveMarks = (await context.OperationServiceCharges.AsNoTracking()
                .Where(mark => ids.Contains(mark.OperationServiceId) && mark.RemovedAt == null)
                .Select(mark => new { mark.OperationServiceId, mark.PublicId }).ToArrayAsync(cancellationToken))
            .ToLookup(mark => mark.OperationServiceId, mark => mark.PublicId);
        var frozen = sources.Select(source =>
        {
            OccReviewServiceData? evidence = null;
            IReadOnlyList<ServiceChargeEvidence> charges = [];
            ServiceTimingEvidence? timing = null;
            if (source.EvidenceJson is not null)
            {
                try
                {
                    var snapshot = OperationSubmissionEvidence.Parse(source.EvidenceJson);
                    evidence = snapshot.Services.SingleOrDefault(item => item.Id == source.ServicePublicId);
                    charges = snapshot.ChargesOf(source.ServicePublicId);
                    timing = snapshot.TimingOf(source.ServicePublicId);
                }
                catch (JsonException) { }
                catch (InvalidOperationException) { }
            }
            return (Source: source, Evidence: evidence, Charges: charges, Timing: timing);
        }).ToArray();
        // 3-N29: a charge its contract excludes blocks the service instead of being valued at zero.
        var carryingExcluded = await ContractChargeExclusions.ServicesCarryingExcludedAsync(context,
            frozen.SelectMany(item => item.Charges.Select(charge => (item.Source.ServiceId, charge.ChargeId))).ToArray(),
            cancellationToken);
        return frozen.Select(item =>
        {
            var (source, evidence, charges, timing) = item;
            var evidenceMatches = evidence is not null &&
                liveMarks[source.ServiceId].Order().SequenceEqual(charges.Select(charge => charge.MarkId).Order()) &&
                evidence.Status == source.Status.ToString() &&
                evidence.ExecutedQuantity == source.ExecutedQuantity &&
                evidence.ContractedQuantity == source.ContractedQuantity &&
                evidence.Unit == source.BillingUnit;
            var valuation = evidenceMatches
                ? FinanceApprovedServicePolicy.Evaluate(source.Status, source.ExecutedQuantity, source.UnitPrice,
                    source.Currency, source.BillingUnit, source.BillingExcluded, carryingExcluded.Contains(source.ServiceId))
                : new FinanceServiceValuation(false, "approved_evidence_mismatch", null);
            return new Valued(source, evidence, charges, timing, valuation);
        }).ToArray();
    }
}
