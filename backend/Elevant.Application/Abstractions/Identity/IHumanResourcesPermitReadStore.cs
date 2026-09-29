namespace Elevant.Application.Abstractions.Identity;

public sealed record HumanResourcesPermitData(Guid Id, Guid RampProfileId,
    string AgentName, string EmployeeNumber, string DocumentType, int CycleNumber,
    string DocumentNumber, DateOnly IssuedOn, DateOnly ExpiresOn);

public sealed record HumanResourcesPermitPage(int Page, int Limit, bool HasMore,
    IReadOnlyList<HumanResourcesPermitData> Permits);

public interface IHumanResourcesPermitReadStore
{
    /// <summary>Returns null unless the actor has live internal HR or Superadmin access.</summary>
    Task<HumanResourcesPermitPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default);
}
