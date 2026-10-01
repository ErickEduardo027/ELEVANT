namespace Elevant.Application.Abstractions.Identity;

public sealed record HumanResourcesAvailabilityRequestData(
    Guid Id, Guid RampProfileId, string AgentName, string EmployeeNumber,
    DateOnly StartsOn, DateOnly EndsOn, string Type, string Status,
    string Reason, DateTimeOffset RequestedAt, DateTimeOffset? ResolvedAt,
    string? ResolutionNote);

public sealed record HumanResourcesAvailabilityRequestPage(
    DateOnly From, DateOnly To, int Page, int Limit, bool HasMore,
    IReadOnlyList<HumanResourcesAvailabilityRequestData> Requests);

public interface IHumanResourcesAvailabilityReadStore
{
    /// <summary>Returns null unless the actor has live internal HR/Superadmin access.</summary>
    Task<HumanResourcesAvailabilityRequestPage?> ListAsync(Guid actorId,
        DateOnly startDate, DateOnly endDate, int page, int limit,
        CancellationToken cancellationToken = default);
}
