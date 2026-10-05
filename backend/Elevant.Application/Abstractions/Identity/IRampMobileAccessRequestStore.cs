namespace Elevant.Application.Abstractions.Identity;

public sealed record RampMobileAccessRequestData(Guid Id, Guid RampProfileId,
    string Status, DateTimeOffset RequestedAt, DateTimeOffset? DecidedAt,
    string? DecisionReason, Guid? AccountId, string Version);

public enum MobileAccessRequestFailure { Forbidden, Invalid, NotFound, Conflict }

public sealed record MobileAccessRequestResult(RampMobileAccessRequestData? Request,
    MobileAccessRequestFailure? Failure)
{
    public static MobileAccessRequestResult Success(RampMobileAccessRequestData request) =>
        new(request, null);
    public static MobileAccessRequestResult Failed(MobileAccessRequestFailure failure) =>
        new(null, failure);
}

public interface IRampMobileAccessRequestStore
{
    Task<IReadOnlyList<RampMobileAccessRequestData>?> ListForHumanResourcesAsync(
        Guid actorId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<RampMobileAccessRequestData>?> ListForGovernanceAsync(
        Guid actorId, CancellationToken cancellationToken = default);
    Task<MobileAccessRequestResult> RequestAsync(Guid actorId, Guid profileId,
        Guid requestId, CancellationToken cancellationToken = default);
    Task<MobileAccessRequestResult> RejectAsync(Guid actorId, Guid requestId,
        string reason, string expectedVersion, CancellationToken cancellationToken = default);
}
