using Elevant.Domain.Enumerations;

namespace Elevant.Application.Integration;

public sealed record MobileDeviceRegistrationWriteRequest(
    Guid ActorAccountId,
    Guid InstallationId,
    MobilePlatform Platform,
    string AppVersion,
    string? DeviceName,
    string? OperatingSystemVersion);

public sealed record MobileDeviceRegistrationData(
    Guid InstallationId,
    string Platform,
    string AppVersion,
    DateTimeOffset LastSeenAt);

public enum MobileDeviceRegistrationWriteFailure
{
    Forbidden,
    Conflict,
}

/// <summary>
/// Outcome of a registration. <paramref name="Code"/> is the stable Problem Details code of a failure the tablet
/// explains (<see cref="MobileDeviceCodes"/>); the response body of a success never changes, because the deployed APK
/// validates it strictly.
/// </summary>
public sealed record MobileDeviceRegistrationWriteResult(
    MobileDeviceRegistrationData? Device,
    MobileDeviceRegistrationWriteFailure? Failure,
    Guid? CommitReceiptId,
    string? Code = null)
{
    public bool IsSuccess => Device is not null && Failure is null;

    public static MobileDeviceRegistrationWriteResult Success(
        MobileDeviceRegistrationData device,
        Guid commitReceiptId) =>
        new(device, null, commitReceiptId);

    public static MobileDeviceRegistrationWriteResult Failed(
        MobileDeviceRegistrationWriteFailure failure,
        string? code = null) =>
        new(null, failure, null, code);
}

/// <summary>Problem Details codes of the shared tablets (2-N02).</summary>
public static class MobileDeviceCodes
{
    /// <summary>OCC revoked the installation (a lost tablet): it never registers again.</summary>
    public const string Revoked = "device_revoked";

    /// <summary>Another agent holds the tablet with an operation in progress; OCC can unbind it.</summary>
    public const string InUseByActiveAgent = "device_in_use_by_active_agent";

    /// <summary>The installation registered with another platform.</summary>
    public const string PlatformMismatch = "device_platform_mismatch";

    /// <summary>The tablet is not bound (to the caller, for a release; to anybody, for OCC).</summary>
    public const string NotBound = "device_not_bound";
}

/// <summary>
/// The tablet releases its own binding when the agent signs out (2-N02). The Idempotency-Key is scoped to the
/// installation (<c>integration.mobile_command_receipts</c>); the expected state is the binding itself: only the
/// account that holds the tablet releases it.
/// </summary>
public sealed record MobileDeviceReleaseWriteRequest(Guid ActorAccountId, Guid InstallationId, Guid IdempotencyKey);

public enum MobileDeviceReleaseWriteFailure
{
    Forbidden,
    NotFound,
    Conflict,
    IdempotencyKeyConflict,
}

public sealed record MobileDeviceReleaseWriteResult(MobileDeviceReleaseWriteFailure? Failure, string? Code)
{
    public bool IsSuccess => Failure is null;

    public static MobileDeviceReleaseWriteResult Released() => new(null, null);

    public static MobileDeviceReleaseWriteResult Failed(MobileDeviceReleaseWriteFailure failure, string? code = null) =>
        new(failure, code);
}
