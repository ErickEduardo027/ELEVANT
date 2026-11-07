using System.Globalization;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Integration;

/// <summary>
/// A registration of the tablet by its agent. <paramref name="SessionStartedAt"/> is when the agent's session began
/// (<see cref="MobileDeviceSession"/>): the first registration of a session renews a binding the agent still holds
/// from an earlier one. Without it the registration only refreshes that binding.
/// </summary>
public sealed record MobileDeviceRegistrationWriteRequest(
    Guid ActorAccountId,
    Guid InstallationId,
    MobilePlatform Platform,
    string AppVersion,
    string? DeviceName,
    string? OperatingSystemVersion,
    DateTimeOffset? SessionStartedAt = null);

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

    /// <summary>
    /// A release whose tablet a later session of its agent holds now (<see cref="MobileDeviceReleaseVersion"/>).
    /// </summary>
    public const string VersionConflict = "version_conflict";
}

/// <summary>
/// The session of the tablet's agent (2-N02). It begins when its access token is issued (the token's <c>iat</c>):
/// the app signs in for each session and never refreshes that token. Each session holds its own binding: the first
/// registration of a session renews a binding the agent still holds from an earlier one (which signed out without
/// releasing it, or whose release is still on its way), so a late release of the earlier session frees nothing.
/// </summary>
public static class MobileDeviceSession
{
    private const long LastUnixSecond = 253_402_300_799;

    /// <summary>When the session began, from its token's <c>iat</c> (Unix seconds); null when the token has none.</summary>
    public static DateTimeOffset? StartedAt(string? issuedAt) =>
        long.TryParse(issuedAt, NumberStyles.None, CultureInfo.InvariantCulture, out var seconds) &&
        seconds is > 0 and <= LastUnixSecond
            ? DateTimeOffset.FromUnixTimeSeconds(seconds)
            : null;

    /// <summary>The agent's open binding began before this session did: an earlier session holds it.</summary>
    public static bool HeldByEarlierSession(DateTimeOffset boundAt, DateTimeOffset? sessionStartedAt) =>
        sessionStartedAt is { } started && boundAt < started;
}

/// <summary>
/// The tablet releases its own binding when the agent signs out (2-N02). The Idempotency-Key is scoped to the
/// installation (<c>integration.mobile_command_receipts</c>). Only the account that holds the tablet releases it, and
/// <paramref name="ExpectedVersion"/> (see <see cref="MobileDeviceReleaseVersion"/>) keeps a late release from freeing
/// it after the agent signed in on it again.
/// </summary>
public sealed record MobileDeviceReleaseWriteRequest(Guid ActorAccountId, Guid InstallationId, Guid IdempotencyKey,
    DateTimeOffset? ExpectedVersion = null);

/// <summary>
/// The expected version of a release (2-N02): the <c>lastSeenAt</c> of a registration of the agent's session, the
/// newest the app confirmed. The binding of that session began at or before it (<see cref="MobileDeviceSession"/>), so
/// an open binding that began after it belongs to a later session (the agent signed in on the tablet again while the
/// release was on its way) and the release is refused with <c>version_conflict</c>. What the session itself did after
/// that registration (its writes and registrations move the tablet's <c>lastSeenAt</c>) never refuses it. A session
/// that confirmed no registration since the app started sends none and only the holder is checked.
/// </summary>
public static class MobileDeviceReleaseVersion
{
    /// <summary>Reads the version a release sends: none is valid, a malformed one is not.</summary>
    public static bool TryParse(string? value, out DateTimeOffset? version)
    {
        version = null;
        if (value is null) return true;
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal,
                out var parsed))
            return false;
        version = parsed.ToUniversalTime();
        return true;
    }

    /// <summary>The open binding began after the registration the release names: a later session holds it.</summary>
    public static bool Superseded(DateTimeOffset? version, DateTimeOffset boundAt) =>
        version is { } expected && boundAt > expected;
}

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
