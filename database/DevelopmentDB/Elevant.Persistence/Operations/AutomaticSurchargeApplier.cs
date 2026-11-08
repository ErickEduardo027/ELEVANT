using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Marks the automatic surcharges on the operation's billable services right before its evidence is frozen for OCC
/// (ADR-0034). A charge per service applies to every eligible service (night, Sunday/holiday); an hourly charge of the
/// whole operation (package exceeded, delay) goes once, on its first eligible service. Nothing is marked twice, the
/// contract's exclusions are respected (<see cref="ContractChargeExclusions"/>) and a charge OCC already removed from a
/// service is not marked again on a later hand-off. A service is eligible when it is billed
/// (<see cref="ServiceBillability"/>, 3-N11): completed or in exception with an executed quantity, not excluded by OCC.
/// <see cref="PlanAsync"/> decides the marks and
/// <see cref="ApplyAsync(ElevantDbContext, long, DateTimeOffset, DateTimeOffset, CancellationToken)"/> writes them; the Service Order shows the plan
/// before the hand-off (<see cref="ProjectAsync"/>, 3-N02), so what the agent and the airline sign is what is frozen.
/// </summary>
internal static class AutomaticSurchargeApplier
{
    private static readonly HashSet<string> OncePerOperation =
        [AutomaticSurchargeCodes.Overtime, AutomaticSurchargeCodes.Delay];

    /// <summary>The reason a recalculation retires an automatic surcharge (3-N09, 3-N06).</summary>
    public const string RecalculatedReason = "Recalculado con las horas corregidas";

    /// <summary>A surcharge the times justify on a service that does not carry it yet.</summary>
    internal sealed record PlannedSurcharge(long OperationServiceId, long ChargeDefinitionId, string Code);

    public static Task<IReadOnlyList<string>> ApplyAsync(ElevantDbContext context, long operationId,
        DateTimeOffset now, CancellationToken cancellationToken) =>
        ApplyAsync(context, operationId, now, now, cancellationToken);

    /// <summary>
    /// Marks the surcharges the times justify (<see cref="PlanAsync"/>); <c>handedOffAt</c> ends the operation when
    /// push-back was not recorded (its first hand-off) and <c>now</c> is when the marks are written.
    /// </summary>
    public static async Task<IReadOnlyList<string>> ApplyAsync(ElevantDbContext context, long operationId,
        DateTimeOffset handedOffAt, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var plan = await PlanAsync(context, operationId, handedOffAt, cancellationToken);
        foreach (var mark in plan)
            context.OperationServiceCharges.Add(new OperationServiceCharge
            {
                PublicId = Guid.CreateVersion7(), OperationServiceId = mark.OperationServiceId,
                ChargeDefinitionId = mark.ChargeDefinitionId, Source = ChargeMarkSource.Automatic, AppliedAt = now,
                CreatedAt = now, UpdatedAt = now,
            });
        return plan.Select(mark => mark.Code).Distinct().ToArray();
    }

    /// <summary>
    /// The automatic marks the times justify on the operation's billable services and that are not on them yet, in the
    /// order the policy detects them. Nothing is written.
    /// </summary>
    public static async Task<IReadOnlyList<PlannedSurcharge>> PlanAsync(ElevantDbContext context, long operationId,
        DateTimeOffset handedOffAt, CancellationToken cancellationToken)
    {
        var charges = await context.ChargeDefinitions.AsNoTracking()
            .Where(charge => charge.IsActive && AutomaticSurchargeCodes.All.Contains(charge.Code))
            .Select(charge => new { charge.Id, charge.Code, charge.AppliesToAllServices, charge.GraceMinutes })
            .ToArrayAsync(cancellationToken);
        if (charges.Length == 0) return [];
        var facts = await OperationCloseFacts.LoadAsync(context, operationId, handedOffAt, cancellationToken);
        var grace = charges.ToDictionary(charge => charge.Code, charge => charge.GraceMinutes);
        var codes = AutomaticSurchargePolicy.Detect(facts.ToSurchargeInput(), grace);
        if (codes.Count == 0) return [];

        var services = await context.OperationServices.AsNoTracking()
            .Where(service => service.GroundOperationId == operationId)
            .Where(ServiceBillability.Billable)
            .OrderBy(service => service.LineNumber)
            .Select(service => new { service.Id, service.ServiceDefinitionId })
            .ToArrayAsync(cancellationToken);
        var serviceIds = services.Select(service => service.Id).ToArray();
        var chargeIds = charges.Select(charge => charge.Id).ToArray();
        var links = await context.ChargeDefinitionServices.AsNoTracking()
            .Where(link => chargeIds.Contains(link.ChargeDefinitionId))
            .Select(link => new { link.ChargeDefinitionId, link.ServiceDefinitionId }).ToArrayAsync(cancellationToken);
        var exclusions = await ContractChargeExclusions.ForServicesAsync(context, serviceIds, cancellationToken);
        var marks = await context.OperationServiceCharges.AsNoTracking()
            .Where(mark => serviceIds.Contains(mark.OperationServiceId))
            .Select(mark => new { mark.OperationServiceId, mark.ChargeDefinitionId, mark.RemovedAt, mark.RemovedByAccountId })
            .ToArrayAsync(cancellationToken);

        var planned = new List<PlannedSurcharge>();
        foreach (var code in codes)
        {
            var charge = charges.Single(item => item.Code == code);
            var eligible = services.Where(service =>
                (charge.AppliesToAllServices || links.Any(link =>
                    link.ChargeDefinitionId == charge.Id && link.ServiceDefinitionId == service.ServiceDefinitionId)) &&
                !exclusions.Contains(service.Id, charge.Id) &&
                !marks.Any(mark => mark.OperationServiceId == service.Id && mark.ChargeDefinitionId == charge.Id &&
                    (mark.RemovedAt == null || mark.RemovedByAccountId != null)))
                .ToArray();
            if (OncePerOperation.Contains(code))
            {
                // Already on another service (by the agent or a previous hand-off): the operation has it.
                if (marks.Any(mark => mark.ChargeDefinitionId == charge.Id &&
                        (mark.RemovedAt == null || mark.RemovedByAccountId != null)))
                    continue;
                eligible = eligible.Take(1).ToArray();
            }
            planned.AddRange(eligible.Select(service => new PlannedSurcharge(service.Id, charge.Id, code)));
        }
        return planned;
    }

    /// <summary>
    /// The charges the Service Order shows before the hand-off (3-N02): the marks on the services now, plus the
    /// automatic surcharges the hand-off will mark. In a correction round (<paramref name="correctionRound"/>) the
    /// automatic marks the resubmission will retire are left out too, as <see cref="ReconcileAsync"/> does. Each pair is
    /// (service, charge definition) by internal id. Nothing is written.
    /// </summary>
    public static async Task<IReadOnlyList<(long ServiceId, long ChargeDefinitionId)>> ProjectAsync(
        ElevantDbContext context, long operationId, DateTimeOffset handedOffAt, bool correctionRound,
        CancellationToken cancellationToken)
    {
        var stale = correctionRound
            ? await StaleChargeIdsAsync(context, operationId, handedOffAt, cancellationToken)
            : [];
        var active = await (from mark in context.OperationServiceCharges.AsNoTracking()
                            join service in context.OperationServices.AsNoTracking() on mark.OperationServiceId equals service.Id
                            where service.GroundOperationId == operationId && mark.RemovedAt == null
                            orderby mark.AppliedAt, mark.Id
                            select new { mark.OperationServiceId, mark.ChargeDefinitionId, mark.Source })
            .ToArrayAsync(cancellationToken);
        var kept = active.Where(mark => !(mark.Source == ChargeMarkSource.Automatic && stale.Contains(mark.ChargeDefinitionId)))
            .Select(mark => (mark.OperationServiceId, mark.ChargeDefinitionId));
        var planned = (await PlanAsync(context, operationId, handedOffAt, cancellationToken))
            .Select(mark => (mark.OperationServiceId, mark.ChargeDefinitionId));
        return kept.Concat(planned).ToArray();
    }

    /// <summary>
    /// Recalculates the automatic surcharges with the times as they are now (3-N09: a correction round resubmitted, 3-N06:
    /// late evidence while OCC reviews): marks the ones the times now justify and retires the active automatic marks
    /// they no longer justify. Only ELEVANT's own active marks are retired, by the agent whose corrected times decided
    /// it and with <see cref="RecalculatedReason"/>; the agent's and OCC's marks are never touched, and a later
    /// recalculation may mark a retired one again. <c>handedOffAt</c> ends the operation when push-back was not
    /// recorded (its first hand-off); <c>rampAgentId</c> is the agent whose command triggered the recalculation.
    /// </summary>
    public static async Task<ReconciledSurcharges> ReconcileAsync(ElevantDbContext context, long operationId,
        DateTimeOffset handedOffAt, DateTimeOffset now, long rampAgentId, CancellationToken cancellationToken)
    {
        var staleChargeIds = await StaleChargeIdsAsync(context, operationId, handedOffAt, cancellationToken);
        var codes = await context.ChargeDefinitions.AsNoTracking()
            .Where(charge => staleChargeIds.Contains(charge.Id))
            .Select(charge => new { charge.Id, charge.Code })
            .ToArrayAsync(cancellationToken);
        // Tracked: a no-tracking source anywhere in the query would leave the retired marks unsaved.
        var stale = await (from mark in context.OperationServiceCharges.AsTracking()
                           join service in context.OperationServices on mark.OperationServiceId equals service.Id
                           where service.GroundOperationId == operationId &&
                                 mark.Source == ChargeMarkSource.Automatic && mark.RemovedAt == null &&
                                 staleChargeIds.Contains(mark.ChargeDefinitionId)
                           select mark).ToListAsync(cancellationToken);
        foreach (var mark in stale)
        {
            mark.RemovedAt = now;
            mark.RemovedByRampAgentId = rampAgentId;
            mark.AdjustmentReason = RecalculatedReason;
            mark.UpdatedAt = now;
        }
        var retired = codes.Where(charge => stale.Any(mark => mark.ChargeDefinitionId == charge.Id))
            .Select(charge => charge.Code).ToArray();
        await context.SaveChangesAsync(cancellationToken);
        var applied = await ApplyAsync(context, operationId, handedOffAt, now, cancellationToken);
        return new ReconciledSurcharges(applied, retired);
    }

    /// <summary>
    /// The automatic charge definitions the times no longer justify, active or not, so a recalculation retires their
    /// automatic marks; the grace of each charge is the one Finance defined.
    /// </summary>
    private static async Task<long[]> StaleChargeIdsAsync(ElevantDbContext context, long operationId,
        DateTimeOffset handedOffAt, CancellationToken cancellationToken)
    {
        var charges = await context.ChargeDefinitions.AsNoTracking()
            .Where(charge => AutomaticSurchargeCodes.All.Contains(charge.Code))
            .Select(charge => new { charge.Id, charge.Code, charge.GraceMinutes })
            .ToArrayAsync(cancellationToken);
        var facts = await OperationCloseFacts.LoadAsync(context, operationId, handedOffAt, cancellationToken);
        var detected = AutomaticSurchargePolicy.Detect(facts.ToSurchargeInput(),
            charges.ToDictionary(charge => charge.Code, charge => charge.GraceMinutes));
        return charges.Where(charge => !detected.Contains(charge.Code)).Select(charge => charge.Id).ToArray();
    }
}

/// <summary>What a recalculation of the automatic surcharges marked and retired, by charge code.</summary>
internal sealed record ReconciledSurcharges(IReadOnlyList<string> Applied, IReadOnlyList<string> Retired);
