namespace Elevant.Application.Abstractions.Operations;

public enum PositionCoverageFailure { Forbidden, NotFound, Invalid, Conflict, Rejected }

public sealed record CoverageTerminalData(Guid TerminalId, string Code, string Name, int MaxStandsPerAgent,
    bool RequiresBridgeQualification);

public sealed record CoverageStandRefData(Guid StandId, string Code);

/// <param name="MaxAircraftSize">Narrowbody or Widebody; null admits any size.</param>
/// <param name="CoveredBy">Names of the agents covering the stand on the board's date.</param>
public sealed record CoverageStandData(Guid StandId, string Code, Guid? TerminalId, bool IsActive, bool HasBoardingBridge,
    bool IsRemote, string? MaxAircraftSize, IReadOnlyList<string> CoveredBy);

public sealed record StandConstraintData(Guid Id, Guid StandId, string StandCode, Guid AffectedStandId,
    string AffectedStandCode, string Kind);

/// <summary>An agent with a shift on the board's date, with the facts the rules use.</summary>
public sealed record CoverageAgentData(Guid AgentId, string Name, string EmployeeNumber, Guid TerminalId, string TerminalCode,
    DateTimeOffset ShiftStartsAt, DateTimeOffset ShiftEndsAt, bool IsJunior, bool HasAirportPermit, bool HasDriverLicense,
    bool HasBridgeQualification, bool IsAbsent);

public sealed record CoverageData(Guid Id, Guid AgentId, string AgentName, Guid TerminalId, string TerminalCode,
    IReadOnlyList<CoverageStandRefData> Stands, DateTimeOffset StartsAt, DateTimeOffset EndsAt, Guid? MentorAgentId,
    string? MentorName, string? VehicleCode, bool IsReinforcement);

public sealed record CoverageBoardData(Guid StationId, string StationCode, DateOnly Date,
    IReadOnlyList<CoverageTerminalData> Terminals, IReadOnlyList<CoverageStandData> Stands,
    IReadOnlyList<StandConstraintData> Constraints, IReadOnlyList<CoverageAgentData> Agents,
    IReadOnlyList<CoverageData> Coverages, bool CanAssign, bool CanConfigure);

/// <param name="StartsAt">Null takes the start of the agent's shift that day.</param>
public sealed record CreateCoverageInput(Guid AgentId, Guid TerminalId, IReadOnlyList<Guid> StandIds, DateOnly Date,
    DateTimeOffset? StartsAt, DateTimeOffset? EndsAt, Guid? MentorAgentId, string? VehicleCode, bool IsReinforcement);

public sealed record StandAttributesInput(bool HasBoardingBridge, bool IsRemote, string? MaxAircraftSize, bool IsActive);

public sealed record TerminalRulesInput(int? MaxStandsPerAgent, bool RequiresBridgeQualification);

public sealed record StandConstraintInput(Guid StandId, Guid AffectedStandId, string Kind);

/// <param name="Reasons">Broken rules (codes) when <see cref="Failure"/> is Rejected.</param>
/// <param name="Code">Stable Problem Details code of the failure, when it has one (<c>stand_in_use</c>, 2-A).</param>
public sealed record CoverageResult(CoverageBoardData? Board, PositionCoverageFailure? Failure, IReadOnlyList<string> Reasons,
    string? Code = null)
{
    public static CoverageResult Fail(PositionCoverageFailure failure, IReadOnlyList<string>? reasons = null,
        string? code = null) =>
        new(null, failure, reasons ?? [], code);
}

/// <summary>A stand coverage of the signed-in ramp agent («Mis posiciones de hoy»).</summary>
public sealed record OwnCoverageData(Guid Id, string StationCode, string TerminalCode, IReadOnlyList<string> Stands,
    DateTimeOffset StartsAt, DateTimeOffset EndsAt, string? MentorName, string? VehicleCode, bool IsReinforcement);

/// <summary>
/// Position coverage per shift (ADR-0030): OCC hands each agent the stands they cover during a
/// window of their shift, under Pillier's rules, and configures the stands and their combinations.
/// </summary>
public interface IPositionCoverageStore
{
    Task<CoverageResult> ReadAsync(Guid actorId, Guid stationId, DateOnly date, CancellationToken cancellationToken = default);

    Task<CoverageResult> CreateAsync(Guid actorId, Guid stationId, CreateCoverageInput input,
        CancellationToken cancellationToken = default);

    Task<CoverageResult> ReleaseAsync(Guid actorId, Guid coverageId, DateOnly date, CancellationToken cancellationToken = default);

    Task<CoverageResult> UpdateStandAsync(Guid actorId, Guid standId, StandAttributesInput input, DateOnly date,
        CancellationToken cancellationToken = default);

    Task<CoverageResult> UpdateTerminalAsync(Guid actorId, Guid terminalId, TerminalRulesInput input, DateOnly date,
        CancellationToken cancellationToken = default);

    Task<CoverageResult> AddConstraintAsync(Guid actorId, StandConstraintInput input, DateOnly date,
        CancellationToken cancellationToken = default);

    Task<CoverageResult> RemoveConstraintAsync(Guid actorId, Guid constraintId, DateOnly date,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// OCC releases the agent of an operation that has not started, so it can assign another; the
    /// operation returns to Planned and the agent is told (<c>assignment_released</c>).
    /// </summary>
    Task<PositionCoverageFailure?> ReleaseOperationAgentAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken = default);

    /// <summary>Today's coverages of the signed-in ramp agent; null when the account is not one.</summary>
    Task<IReadOnlyList<OwnCoverageData>?> ReadOwnAsync(Guid accountId, CancellationToken cancellationToken = default);
}
