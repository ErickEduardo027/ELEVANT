using Elevant.Application.Common;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// 2-N25: OCC learns, once per assignment, that an operation it assigned falls outside a current airport permit or
/// ramp licence of its agent — because the document expired or because Gestión Humana corrected its dates. Nothing
/// is released: OCC decides (the planning board marks the agent as unfit, <c>EfOccAssignmentReadinessStore</c>).
/// The notice is operational, for ADMIN_OCC only; the tablet never receives it.
/// </summary>
internal static class AgentDocumentNotices
{
    /// <summary>Operational notice kind of an assignment its agent's document does not cover.</summary>
    public const string AssignmentKind = "agent_document_not_current";

    /// <summary>Documents every ramp agent needs to be assigned (<c>OccAgentEligibilityPolicy</c>).</summary>
    private static readonly PermitDocumentType[] Required = [PermitDocumentType.AirportId, PermitDocumentType.RampDriverLicense];

    /// <summary>
    /// Adds the notices of the open assignments, from today on, of <paramref name="agentIds"/> (every active agent
    /// when null). Reads the current documents as saved, so the caller saves a corrected cycle first. Returns how
    /// many assignments were announced.
    /// </summary>
    public static async Task<int> NotifyUncoveredAssignmentsAsync(ElevantDbContext context, long[]? agentIds,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var today = BusinessCalendar.Today(now);
        var query = from assignment in context.OperationAgentAssignments.AsNoTracking()
                    join operation in context.GroundOperations.AsNoTracking() on assignment.GroundOperationId equals operation.Id
                    join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                    join agent in context.RampAgents.AsNoTracking() on assignment.RampAgentId equals agent.Id
                    where assignment.ReleasedAt == null && agent.IsActive && turnaround.OperationDate >= today &&
                          (operation.CurrentStatus == GroundOperationStatus.Assigned ||
                           operation.CurrentStatus == GroundOperationStatus.InProgress ||
                           operation.CurrentStatus == GroundOperationStatus.Returned)
                    select new { assignment.PublicId, assignment.RampAgentId, OperationId = operation.Id, turnaround.StationId,
                        turnaround.OperationDate };
        if (agentIds is not null) query = query.Where(row => agentIds.Contains(row.RampAgentId));
        var rows = await query.ToArrayAsync(cancellationToken);
        if (rows.Length == 0) return 0;
        var agents = rows.Select(row => row.RampAgentId).Distinct().ToArray();
        var documents = await context.AirportPermitCycles.AsNoTracking()
            .Where(cycle => agents.Contains(cycle.RampAgentId) && cycle.IsCurrent)
            .Select(cycle => new { cycle.RampAgentId, cycle.DocumentType, cycle.IssuedOn, cycle.ExpiresOn })
            .ToArrayAsync(cancellationToken);
        var announced = 0;
        foreach (var row in rows)
        {
            if (!documents.Any(document => document.RampAgentId == row.RampAgentId &&
                    Required.Contains(document.DocumentType) &&
                    (row.OperationDate < document.IssuedOn || document.ExpiresOn < row.OperationDate)))
                continue;
            var recipients = await OperationalNotificationWriter.OccRecipientsAsync(context, row.StationId, now, null,
                cancellationToken);
            var told = await context.OperationalNotifications.AsNoTracking()
                .Where(notification => notification.Kind == AssignmentKind && notification.SourceId == row.PublicId)
                .Select(notification => notification.RecipientAccountId).ToArrayAsync(cancellationToken);
            var fresh = recipients.Except(told).ToArray();
            if (fresh.Length == 0) continue;
            OperationalNotificationWriter.AddForRecipients(context, fresh, row.StationId, row.OperationId, row.PublicId,
                AssignmentKind, now);
            announced++;
        }
        return announced;
    }
}
