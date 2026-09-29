namespace Elevant.Application.Abstractions.Identity;

public sealed record HumanResourcesShiftData(Guid Id, Guid RampProfileId,
    string AgentName, string EmployeeNumber, Guid StationId, string StationCode,
    Guid TerminalId, string TerminalCode, Guid? PositionId, string? PositionCode,
    DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal, string Block);

public sealed record HumanResourcesShiftPage(DateOnly From, DateOnly To,
    int Page, int Limit, bool HasMore, IReadOnlyList<HumanResourcesShiftData> Shifts);

public interface IHumanResourcesShiftReadStore
{
    /// <summary>Returns null unless the actor has live internal HR or Superadmin access.</summary>
    Task<HumanResourcesShiftPage?> ListAsync(Guid actorId, DateOnly startDate, DateOnly endDate,
        int page, int limit, CancellationToken cancellationToken = default);
}
