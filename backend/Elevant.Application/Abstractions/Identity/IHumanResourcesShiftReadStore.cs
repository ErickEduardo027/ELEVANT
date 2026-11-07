namespace Elevant.Application.Abstractions.Identity;

/// <summary>One shift; <c>Version</c> is its rowversion, the expected version of its removal (2-N11).</summary>
public sealed record HumanResourcesShiftData(Guid Id, Guid RampProfileId,
    string AgentName, string EmployeeNumber, Guid StationId, string StationCode,
    Guid TerminalId, string TerminalCode, Guid? PositionId, string? PositionCode,
    DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal, string Block, string Version);

public sealed record HumanResourcesShiftPage(DateOnly From, DateOnly To,
    int Page, int Limit, bool HasMore, IReadOnlyList<HumanResourcesShiftData> Shifts);

public sealed record HumanResourcesShiftTerminalOption(Guid Id, string Code);
public sealed record HumanResourcesShiftStationOption(Guid Id, string Code,
    IReadOnlyList<HumanResourcesShiftTerminalOption> Terminals);
public sealed record HumanResourcesShiftAssignmentOptions(Guid RampProfileId,
    DateOnly WorkDate, bool HasShift,
    IReadOnlyList<HumanResourcesShiftStationOption> Stations);

public interface IHumanResourcesShiftReadStore
{
    /// <summary>Returns null unless the actor has live internal HR or Superadmin access.</summary>
    Task<HumanResourcesShiftPage?> ListAsync(Guid actorId, DateOnly startDate, DateOnly endDate,
        int page, int limit, CancellationToken cancellationToken = default);
    /// <summary>Returns only date-effective active agent station/terminal choices, or null on denial.</summary>
    Task<HumanResourcesShiftAssignmentOptions?> GetAssignmentOptionsAsync(Guid actorId,
        Guid rampProfileId, DateOnly workDate, CancellationToken cancellationToken = default);
}
