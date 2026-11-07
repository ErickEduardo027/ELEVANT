using System.Text.Json.Serialization;

namespace Elevant.Contracts.Operations;

public sealed record OccCoverageTerminalResponse(Guid TerminalId, string Code, string Name, int MaxStandsPerAgent,
    bool RequiresBridgeQualification);

public sealed record OccCoverageStandResponse(Guid StandId, string Code, Guid? TerminalId, bool IsActive, bool HasBoardingBridge,
    bool IsRemote, string? MaxAircraftSize, IReadOnlyList<string> CoveredBy);

public sealed record OccStandConstraintResponse(Guid Id, Guid StandId, string StandCode, Guid AffectedStandId,
    string AffectedStandCode, string Kind);

public sealed record OccCoverageAgentResponse(Guid AgentId, string Name, string EmployeeNumber, Guid TerminalId,
    string TerminalCode, DateTimeOffset ShiftStartsAt, DateTimeOffset ShiftEndsAt, bool IsJunior, bool HasAirportPermit,
    bool HasDriverLicense, bool HasBridgeQualification, bool IsAbsent);

public sealed record OccCoverageStandRefResponse(Guid StandId, string Code);

public sealed record OccCoverageResponse(Guid Id, Guid AgentId, string AgentName, Guid TerminalId, string TerminalCode,
    IReadOnlyList<OccCoverageStandRefResponse> Stands, DateTimeOffset StartsAt, DateTimeOffset EndsAt, Guid? MentorAgentId,
    string? MentorName, string? VehicleCode, bool IsReinforcement);

/// <summary>Position coverage per shift of one station and date (ADR-0030).</summary>
public sealed record OccCoverageBoardResponse(Guid StationId, string StationCode, DateOnly Date,
    IReadOnlyList<OccCoverageTerminalResponse> Terminals, IReadOnlyList<OccCoverageStandResponse> Stands,
    IReadOnlyList<OccStandConstraintResponse> Constraints, IReadOnlyList<OccCoverageAgentResponse> Agents,
    IReadOnlyList<OccCoverageResponse> Coverages, bool CanAssign, bool CanConfigure);

/// <summary>Both times null take the agent's shift that day.</summary>
public sealed record CreateOccCoverageRequest(Guid StationId, DateOnly Date, Guid AgentId, Guid TerminalId,
    IReadOnlyList<Guid> StandIds, DateTimeOffset? StartsAt, DateTimeOffset? EndsAt, Guid? MentorAgentId, string? VehicleCode,
    bool IsReinforcement);

/// <param name="MaxAircraftSize">Narrowbody, Widebody or null for any size.</param>
public sealed record UpdateOccStandAttributesRequest(DateOnly Date, bool HasBoardingBridge, bool IsRemote,
    string? MaxAircraftSize, bool IsActive);

/// <param name="MaxStandsPerAgent">1 to 6; null uses the default of 3.</param>
public sealed record UpdateOccTerminalRulesRequest(DateOnly Date, int? MaxStandsPerAgent, bool RequiresBridgeQualification);

/// <param name="Kind">Cancels or NarrowbodyOnly.</param>
public sealed record AddOccStandConstraintRequest(DateOnly Date, Guid StandId, Guid AffectedStandId, string Kind);

/// <summary>A coverage of the signed-in ramp agent («Mis posiciones de hoy»).</summary>
/// <param name="Partner">The mentor of a trainee, or the trainee a mentor accompanies.</param>
public sealed record RampOwnCoverageResponse(Guid Id, string StationCode, string TerminalCode, IReadOnlyList<string> Stands,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt, string? Partner, string? VehicleCode, bool IsReinforcement);

public sealed record RampOwnCoverageListResponse(IReadOnlyList<RampOwnCoverageResponse> Coverages);

/// <summary>
/// «Relevar agente» (3-F): the agent who works the operation now and the agents of the station evaluated with OCC's
/// assignment rules for what is left of it (from <c>remainingFrom</c> to <c>remainingUntil</c>).
/// </summary>
public sealed record OccHandoverOptionsResponse(Guid TurnaroundId, Guid OperationId, string OperationStatus,
    Guid CurrentAssignmentId, Guid CurrentAgentId, string CurrentAgentName, DateTimeOffset RemainingFrom,
    DateTimeOffset RemainingUntil, IReadOnlyList<OccAgentOptionResponse> Agents);

/// <summary>
/// Hands an operation in progress or returned to <c>agentId</c> (3-F). <c>expectedAssignmentId</c> is the assignment OCC
/// saw (another one is <c>assignment_changed</c>); the reason has 5 to 500 characters. Sent with an Idempotency-Key.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record HandOverOccOperationRequest(Guid AgentId, Guid ExpectedAssignmentId, string? Reason);

/// <summary>The handed-over operation's new assignment; <c>replayed</c> when the same key repeated the command.</summary>
public sealed record OccOperationHandoverResponse(Guid TurnaroundId, Guid AssignmentId, Guid AgentId, Guid PreviousAgentId,
    bool Replayed);
