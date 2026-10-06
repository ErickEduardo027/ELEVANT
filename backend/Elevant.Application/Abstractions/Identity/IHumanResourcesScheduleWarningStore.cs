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
    Task<ScheduleWarningReadResult> ListAsync(Guid actorId, Guid stationId,
        DateOnly startDate, DateOnly endDate, int page, int limit,
        CancellationToken cancellationToken = default);
}
