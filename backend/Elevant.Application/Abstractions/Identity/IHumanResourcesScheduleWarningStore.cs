using Elevant.Application.Identity;

namespace Elevant.Application.Abstractions.Identity;

public enum ScheduleWarningFailure
{
    ForbiddenRole,
    ForbiddenStation,
}

public sealed record ScheduleWarningPage(
    Guid StationId, DateOnly From, DateOnly To, int Page, int Limit,
    bool HasMore, DateTimeOffset AsOf, string RuleVersion,
    DateOnly RuleEffectiveOn, IReadOnlyList<ScheduleWarning> Warnings);

public sealed record ScheduleWarningReadResult(
    ScheduleWarningPage? Page, ScheduleWarningFailure? Failure);

public interface IHumanResourcesScheduleWarningStore
{
    /// <summary>
    /// Warnings of the station's shifts in the range. With <paramref name="includeReadiness"/> the page also
    /// warns about shifts on an approved absence and documents that do not cover the shift's date (2-N24);
    /// without it the response keeps the four original kinds.
    /// </summary>
    Task<ScheduleWarningReadResult> ListAsync(Guid actorId, Guid stationId,
        DateOnly startDate, DateOnly endDate, int page, int limit, bool includeReadiness,
        CancellationToken cancellationToken = default);
}
