namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// An open assignment of the planning board whose agent cannot do it on the operation's date (2-N25): the
/// reasons use the eligibility vocabulary of the assignment options (<c>agent_inactive</c>,
/// <c>approved_absence</c>, <c>airport_id_not_current</c>, <c>ramp_driver_license_not_current</c>).
/// </summary>
public sealed record OccUnfitAssignmentData(Guid AssignmentId, Guid TurnaroundId, Guid AgentId,
    IReadOnlyList<string> Reasons);

/// <summary>The unfit assignments of a station's operations on one date; fit ones are not listed.</summary>
public sealed record OccAssignmentReadinessData(Guid StationId, DateOnly Date,
    IReadOnlyList<OccUnfitAssignmentData> Assignments);

public enum OccAssignmentReadinessFailure { Forbidden, NotFound }

public sealed record OccAssignmentReadinessResult(OccAssignmentReadinessData? Data,
    OccAssignmentReadinessFailure? Failure);

public interface IOccAssignmentReadinessStore
{
    /// <summary>
    /// A projection, re-read with the planning board: nothing is stored and nothing is released. Needs
    /// <c>operations.planning.read</c> and the station in scope (404 otherwise).
    /// </summary>
    Task<OccAssignmentReadinessResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
        CancellationToken cancellationToken = default);
}
