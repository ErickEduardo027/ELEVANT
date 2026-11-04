using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Announces, in the source transaction, that a ground operation changed (ADR-0029): OCC's
/// planning board (<c>occ_planning</c>), the review queue (<c>occ_review</c>) when the change
/// matters for review, and the assigned agents' tablets (<c>ramp_operations</c>). These are hints
/// only; every client re-reads through REST under its current permissions.
/// </summary>
internal static class RampOperationChangeWriter
{
    public const string RampOperationsResource = "ramp_operations";
    public const string OccReviewResource = "occ_review";
    public const string RampScheduleResource = "ramp_schedule";

    public static async Task AnnounceAsync(ElevantDbContext context, long operationId, DateTimeOffset occurredAt,
        bool review, CancellationToken cancellationToken, params long[] alsoAgentIds)
    {
        var operation = await (from item in context.GroundOperations.AsNoTracking()
                               join turnaround in context.Turnarounds.AsNoTracking() on item.TurnaroundId equals turnaround.Id
                               join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                               where item.Id == operationId
                               select new { item.PublicId, StationId = station.Id, StationPublicId = station.PublicId })
            .SingleAsync(cancellationToken);
        await OccPlanningChangeWriter.AddForStationAsync(context, operation.StationId, operation.StationPublicId, occurredAt,
            cancellationToken);
        if (review)
            foreach (var account in await OperationalNotificationWriter.OccRecipientsAsync(context, operation.StationId,
                         occurredAt, null, cancellationToken))
                AccountChangeOutboxWriter.Add(context, account, operation.StationId, OccReviewResource, operation.PublicId,
                    occurredAt);
        var agents = new HashSet<long>(await OperationalNotificationWriter.AssignedAgentRecipientsAsync(context,
            operation.StationId, operationId, occurredAt, null, cancellationToken));
        // An agent who was just released still needs to learn the operation left their list.
        foreach (var agentId in alsoAgentIds)
            agents.UnionWith(await OperationalNotificationWriter.AgentRecipientsAsync(context, agentId, operation.StationId,
                occurredAt, cancellationToken));
        foreach (var account in agents)
            AccountChangeOutboxWriter.Add(context, account, operation.StationId, RampOperationsResource, operation.PublicId,
                occurredAt);
    }

    /// <summary>Tells a ramp agent's own tablet that their shifts or documents changed («Mis turnos»).</summary>
    public static async Task AnnounceScheduleAsync(ElevantDbContext context, long rampAgentId, Guid resourceId,
        DateTimeOffset occurredAt, CancellationToken cancellationToken)
    {
        var accounts = await (from agent in context.RampAgents.AsNoTracking()
                              join account in context.Users.AsNoTracking() on agent.PersonId equals account.PersonId
                              where agent.Id == rampAgentId &&
                                    context.UserRoles.Any(link => link.UserId == account.Id &&
                                        context.Roles.Any(role => role.Id == link.RoleId && role.NormalizedName == "RAMP_AGENT"))
                              select account.Id).Distinct().ToArrayAsync(cancellationToken);
        foreach (var account in accounts)
            AccountChangeOutboxWriter.Add(context, account, null, RampScheduleResource, resourceId, occurredAt);
    }
}
