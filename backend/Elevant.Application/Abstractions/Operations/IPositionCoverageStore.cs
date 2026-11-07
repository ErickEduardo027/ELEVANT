using Elevant.Application.Operations;

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
/// OCC's release of an operation's agent (3-J): the assignment OCC saw (<paramref name="ExpectedAssignmentId"/>) and the
/// intent's Idempotency-Key. Both are optional while older clients exist (expand); a key needs the assignment.
/// </summary>
public sealed record ReleaseOperationAgentInput(Guid? ExpectedAssignmentId = null, Guid? IdempotencyKey = null);

/// <summary>Outcome of a command on an operation's agent; <paramref name="Code"/> names the rule a failure broke.</summary>
public sealed record OperationAgentCommandResult(PositionCoverageFailure? Failure, string? Code = null)
{
    // Both arguments: «new(null)» would bind to the record's copy constructor.
    public static readonly OperationAgentCommandResult Done = new(null, null);

    public static OperationAgentCommandResult Fail(PositionCoverageFailure failure, string code) => new(failure, code);
}

/// <summary>
/// «Relevar agente» (3-F): who works the operation now and the agents of the station that may take what is left of it,
/// evaluated with OCC's assignment rules over the remaining window (the current agent is not listed).
/// </summary>
public sealed record OccHandoverOptionsData(Guid TurnaroundId, Guid OperationId, string OperationStatus,
    Guid CurrentAssignmentId, Guid CurrentAgentId, string CurrentAgentName, DateTimeOffset RemainingFrom,
    DateTimeOffset RemainingUntil, IReadOnlyList<OccAgentOptionData> Agents);

/// <summary>The agent who takes the operation, the assignment OCC saw and the reason (5 to 500 characters).</summary>
public sealed record HandOverOperationInput(Guid AgentId, Guid ExpectedAssignmentId, string? Reason);

/// <summary>The new assignment of a handed-over operation; <paramref name="Replayed"/> when the key repeated it.</summary>
public sealed record OccOperationHandoverData(Guid TurnaroundId, Guid AssignmentId, Guid AgentId, Guid PreviousAgentId,
    bool Replayed);

public sealed record OccHandoverResult<T>(T? Value, PositionCoverageFailure? Failure, string? Code = null) where T : class
{
    public static OccHandoverResult<T> Success(T value) => new(value, null);

    public static OccHandoverResult<T> Fail(PositionCoverageFailure failure, string code) => new(null, failure, code);
}

/// <summary>
/// Position coverage per shift (ADR-0030): OCC hands each agent the stands they cover during a
/// window of their shift, under Pillier's rules, and configures the stands and their combinations.
/// </summary>
public interface IPositionCoverageStore
{
    Task<CoverageResult> ReadAsync(Guid actorId, Guid stationId, DateOnly date, CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates a coverage (ADR-0030). With an Idempotency-Key (optional while older clients exist, 3-J) the same key and
    /// body answer the board again instead of a second coverage; the key with another body is
    /// <c>idempotency_conflict</c>.
    /// </summary>
    Task<CoverageResult> CreateAsync(Guid actorId, Guid stationId, CreateCoverageInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>Releases a coverage; releasing twice answers the board. The key works as in <see cref="CreateAsync"/>.</summary>
    Task<CoverageResult> ReleaseAsync(Guid actorId, Guid coverageId, DateOnly date, Guid? idempotencyKey,
        CancellationToken cancellationToken = default);

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
    /// operation returns to Planned and the agent is told (<c>assignment_released</c>). 3-J: another agent than the one
    /// OCC saw is <c>assignment_changed</c>; a started operation is <c>operation_started</c> (it is handed over instead);
    /// the same key replays the release.
    /// </summary>
    Task<OperationAgentCommandResult> ReleaseOperationAgentAsync(Guid actorId, Guid turnaroundId,
        ReleaseOperationAgentInput input, CancellationToken cancellationToken = default);

    /// <summary>
    /// 3-F: the agents who may take an operation in progress or returned for correction from its agent
    /// (<c>handover_not_allowed</c> in any other status).
    /// </summary>
    Task<OccHandoverResult<OccHandoverOptionsData>> ReadHandoverOptionsAsync(Guid actorId, Guid turnaroundId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// 3-F: OCC hands an operation in progress or returned to another eligible agent with a reason. The Idempotency-Key is
    /// required; the operation keeps its status and its evidence (each row keeps its author); both agents are told.
    /// </summary>
    Task<OccHandoverResult<OccOperationHandoverData>> HandOverOperationAsync(Guid actorId, Guid turnaroundId,
        HandOverOperationInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Today's coverages of the signed-in ramp agent; null when the account is not one.</summary>
    Task<IReadOnlyList<OwnCoverageData>?> ReadOwnAsync(Guid accountId, CancellationToken cancellationToken = default);
}
