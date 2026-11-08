using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Reads what the evidence window of an operation depends on (3-N25): its start, the arrival as recorded (OCC's
/// correction included, 3-N08), its status and its hand-offs to OCC. The rule itself is
/// <see cref="RampEvidenceTimePolicy"/>; milestones, damages, incidents and service transitions share it, and the
/// <see cref="RampEvidenceKind"/> of what is recorded decides where a correction round closes it.
/// </summary>
internal static class RampEvidenceWindowReader
{
    public static async Task<RampEvidenceWindow> ReadAsync(ElevantDbContext context, GroundOperation operation,
        RampEvidenceKind kind, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var arrivals = await context.FlightLegs.AsNoTracking()
            .Where(leg => leg.TurnaroundId == operation.TurnaroundId && leg.Direction == FlightDirection.Arrival)
            .Select(leg => leg.ActualAt)
            .Take(2)
            .ToArrayAsync(cancellationToken);
        var arrivalActualAt = arrivals.Length == 1 ? arrivals[0] : null;
        var handOffs = await context.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == operation.Id)
            .OrderBy(item => item.RevisionNumber)
            .Select(item => item.SubmittedAt)
            .ToArrayAsync(cancellationToken);
        DateTimeOffset? firstSubmittedAt = handOffs.Length == 0 ? null : handOffs[0];
        DateTimeOffset? lastSubmittedAt = handOffs.Length == 0 ? null : handOffs[^1];
        return RampEvidenceTimePolicy.WindowFor(operation.ActualStartAt ?? now, arrivalActualAt,
            RampEvidenceTimePolicy.ClosedAt(kind, operation.CurrentStatus, operation.ActualEndAt, firstSubmittedAt,
                lastSubmittedAt), now);
    }

    /// <summary>When the operation was handed to OCC the first time (its first revision), if it ever was.</summary>
    public static Task<DateTimeOffset?> FirstSubmittedAtAsync(ElevantDbContext context, long operationId,
        CancellationToken cancellationToken) =>
        context.OperationSubmissions.AsNoTracking()
            .Where(item => item.GroundOperationId == operationId)
            .OrderBy(item => item.RevisionNumber)
            .Select(item => (DateTimeOffset?)item.SubmittedAt)
            .FirstOrDefaultAsync(cancellationToken);
}
