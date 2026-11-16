namespace Elevant.Application.Abstractions.Identity;

public sealed record RampMobileAccessRequestData(Guid Id, Guid RampProfileId,
    string Status, DateTimeOffset RequestedAt, DateTimeOffset? DecidedAt,
    string? DecisionReason, Guid? AccountId, string Version);

public enum MobileAccessRequestFailure { Forbidden, Invalid, NotFound, Conflict }

/// <summary>
/// Outcome of a legacy mobile access request command. <paramref name="Code"/> is the stable Problem Details code a
/// failure names (2-N39); without one the route answers the default of its kind.
/// </summary>
public sealed record MobileAccessRequestResult(RampMobileAccessRequestData? Request,
    MobileAccessRequestFailure? Failure, string? Code = null)
{
    public static MobileAccessRequestResult Success(RampMobileAccessRequestData request) =>
        new(request, null);
    public static MobileAccessRequestResult Failed(MobileAccessRequestFailure failure, string? code = null) =>
        new(null, failure, code);
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
