namespace Elevant.Contracts.Operations;

public sealed record OccCoverageTerminalResponse(Guid TerminalId, string Code, string Name, int MaxStandsPerAgent,
    bool RequiresBridgeQualification);

/// <summary>
/// A stand of the board. <paramref name="Version"/> is its rowversion in base64, the same one «Datos maestros» shows:
/// the expected version of the next change of its attributes (2-A).
/// </summary>
public sealed record OccCoverageStandResponse(Guid StandId, string Code, Guid? TerminalId, bool IsActive, bool HasBoardingBridge,
    bool IsRemote, string? MaxAircraftSize, IReadOnlyList<string> CoveredBy, string Version);

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
/// <param name="ExpectedVersion">
/// The stand's version on the board; a stale one is <c>version_conflict</c>. Optional while older screens exist
/// (expand); required with an Idempotency-Key.
/// </param>
public sealed record UpdateOccStandAttributesRequest(DateOnly Date, bool HasBoardingBridge, bool IsRemote,
    string? MaxAircraftSize, bool IsActive, string? ExpectedVersion = null);

/// <param name="MaxStandsPerAgent">1 to 6; null uses the default of 3.</param>
public sealed record UpdateOccTerminalRulesRequest(DateOnly Date, int? MaxStandsPerAgent, bool RequiresBridgeQualification);

/// <param name="Kind">Cancels or NarrowbodyOnly.</param>
public sealed record AddOccStandConstraintRequest(DateOnly Date, Guid StandId, Guid AffectedStandId, string Kind);

/// <summary>A coverage of the signed-in ramp agent («Mis posiciones de hoy»).</summary>
/// <param name="Partner">The mentor of a trainee, or the trainee a mentor accompanies.</param>
public sealed record RampOwnCoverageResponse(Guid Id, string StationCode, string TerminalCode, IReadOnlyList<string> Stands,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt, string? Partner, string? VehicleCode, bool IsReinforcement);

public sealed record RampOwnCoverageListResponse(IReadOnlyList<RampOwnCoverageResponse> Coverages);
