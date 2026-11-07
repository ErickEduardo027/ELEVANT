namespace Elevant.Application.Abstractions.Commercial;

/// <summary>What the signed-in portal user may do for its airline (2-N20).</summary>
/// <param name="AccountId">The signed-in portal account.</param>
/// <param name="Representative">Speaks for the airline: manages its portal users and signs.</param>
/// <param name="Signer">Signs contracts and submits the JAC permit.</param>
/// <param name="CanSign">Representative or signer.</param>
/// <param name="CanManageUsers">Representative: invites, deactivates and reactivates users and marks signers.</param>
public sealed record AirlinePortalCapabilitiesData(Guid AccountId, bool Representative, bool Signer, bool CanSign,
    bool CanManageUsers);

/// <summary>A portal user of the airline as its users see it; <paramref name="Version"/> is the account version.</summary>
public sealed record AirlinePortalUserData(Guid Id, string FirstName, string LastName, string Email, string Status,
    bool InvitationPending, bool Representative, bool Signer, DateTimeOffset? LastLoginAt, string Version);

/// <summary>The caller's capabilities and every portal user of its airline.</summary>
public sealed record AirlinePortalUsersData(AirlinePortalCapabilitiesData Me, IReadOnlyList<AirlinePortalUserData> Users);

/// <summary>A representative invites a user by email; <paramref name="Signer"/> lets it sign from the start.</summary>
public sealed record InviteAirlinePortalUserInput(string? FirstName, string? LastName, string? Email, bool Signer = false);

public sealed record SetAirlinePortalUserStatusInput(bool IsActive, string? ExpectedVersion);

public sealed record SetAirlinePortalUserSignerInput(bool Signer, string? ExpectedVersion);

public enum AirlinePortalUserFailure
{
    Forbidden,
    NotFound,
    Invalid,
    Conflict,
}

public sealed record AirlinePortalUserResult(AirlinePortalUserData? User, AirlinePortalUserFailure? Failure, string? Code,
    bool Replayed = false)
{
    public static AirlinePortalUserResult Success(AirlinePortalUserData user, bool replayed = false) =>
        new(user, null, null, replayed);

    public static AirlinePortalUserResult Failed(AirlinePortalUserFailure failure, string code) => new(null, failure, code);
}

/// <summary>
/// The airline manages its own portal users (2-N20). Every portal user reads the list and its own capabilities;
/// a representative invites users by email, deactivates and reactivates them and marks signers, never itself nor
/// another representative. Each change queues a notice to the other representatives. Every command takes an
/// Idempotency-Key; the changes of an existing user also take its version.
/// </summary>
public interface IAirlinePortalUserStore
{
    Task<AirlinePortalUsersData?> ListAsync(Guid actorId, CancellationToken cancellationToken = default);

    Task<AirlinePortalUserResult> InviteAsync(Guid actorId, InviteAirlinePortalUserInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default);

    Task<AirlinePortalUserResult> SetStatusAsync(Guid actorId, Guid userId, SetAirlinePortalUserStatusInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<AirlinePortalUserResult> SetSignerAsync(Guid actorId, Guid userId, SetAirlinePortalUserSignerInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);
}
