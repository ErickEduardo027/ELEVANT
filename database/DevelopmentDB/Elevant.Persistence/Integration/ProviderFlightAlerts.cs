using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>
/// The notice OCC gets when a provider cancels or diverts a flight it already imported (3-A). The paid feed raises it
/// when a leg's status changes, and a demo flight the superadministrator cancels raises the same one (ADR-0041): OCC
/// decides what to do with the turnaround, nothing is cancelled for it.
/// </summary>
internal static class ProviderFlightAlerts
{
    /// <summary>
    /// Tells the station's OCC that the provider cancelled or diverted an imported flight still open. The turnaround is
    /// the notice's source and a notice of that kind already on its operation counts, so it reaches each OCC account once
    /// whichever leg the provider reports, in one read or in several. The caller saves.
    /// </summary>
    public static async Task AlertOccAsync(ElevantDbContext context, long turnaroundId, string kind,
        DateTimeOffset occurredAt, CancellationToken cancellationToken)
    {
        var target = await (from turnaround in context.Turnarounds.AsNoTracking()
                            join operation in context.GroundOperations.AsNoTracking() on turnaround.Id equals operation.TurnaroundId
                            where turnaround.Id == turnaroundId &&
                                  turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
                                  turnaround.CurrentStatus != TurnaroundStatus.Diverted &&
                                  turnaround.CurrentStatus != TurnaroundStatus.Completed
                            select new { turnaround.StationId, turnaround.PublicId, OperationId = operation.Id })
            .FirstOrDefaultAsync(cancellationToken);
        // By operation, not by source: earlier notices named the leg's proposal as their source.
        if (target is null || await context.OperationalNotifications.AsNoTracking()
                .AnyAsync(notice => notice.GroundOperationId == target.OperationId && notice.Kind == kind, cancellationToken))
            return;
        await OperationalNotificationWriter.NotifyOccAsync(context, target.StationId, target.OperationId, target.PublicId,
            kind, occurredAt, null, cancellationToken);
    }
}
