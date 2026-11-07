namespace Elevant.Contracts.Operations;

/// <summary>
/// An open assignment of the planning board whose agent cannot do it on the operation's date (2-N25). The reasons
/// are the eligibility codes of the assignment options: <c>agent_inactive</c>, <c>approved_absence</c>,
/// <c>airport_id_not_current</c> and <c>ramp_driver_license_not_current</c>.
/// </summary>
public sealed record OccUnfitAssignmentResponse(Guid AssignmentId, Guid TurnaroundId, Guid AgentId,
    IReadOnlyList<string> Reasons);

/// <summary>The unfit assignments of a station's operations on one date; fit assignments are not listed.</summary>
public sealed record OccAssignmentReadinessResponse(Guid StationId, DateOnly Date,
    IReadOnlyList<OccUnfitAssignmentResponse> Assignments);
