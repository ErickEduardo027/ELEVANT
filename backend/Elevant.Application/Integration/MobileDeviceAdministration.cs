using System.Globalization;
using System.Text;

namespace Elevant.Application.Integration;

/// <summary>The agent who holds a tablet, or held it last when it is free or revoked.</summary>
public sealed record OccMobileDeviceAgentData(Guid AccountId, Guid? RampAgentId, string Name, string? EmployeeNumber);

/// <summary>
/// One shared tablet as OCC sees it (2-N02). <paramref name="Status"/> is <c>Bound</c>, <c>Unbound</c> or
/// <c>Revoked</c>; <paramref name="Version"/> is the opaque binding token every command sends back.
/// </summary>
public sealed record OccMobileDeviceData(
    Guid Id,
    string Platform,
    string? DeviceName,
    string AppVersion,
    string? OperatingSystemVersion,
    DateTimeOffset LastSeenAt,
    string Status,
    OccMobileDeviceAgentData? Agent,
    DateTimeOffset? BoundAt,
    DateTimeOffset? UnboundAt,
    DateTimeOffset? RevokedAt,
    bool AgentHasOperationInProgress,
    string Version);

/// <summary>Tablets last used by agents of a station in the actor's scope and what the actor may do with them.</summary>
public sealed record OccMobileDevicesData(
    Guid StationId,
    string StationCode,
    bool CanUnbind,
    bool CanRevoke,
    IReadOnlyList<OccMobileDeviceData> Devices);

/// <summary>OCC frees a tablet; <paramref name="ExpectedVersion"/> is the binding token on screen.</summary>
public sealed record UnbindMobileDeviceInput(string? ExpectedVersion, string? Reason = null);

/// <summary>OCC revokes a lost tablet with a reason; the sessions of the account that held it end too.</summary>
public sealed record RevokeMobileDeviceInput(string? ExpectedVersion, string? Reason);

public enum MobileDeviceAdministrationFailure
{
    Forbidden,
    NotFound,
    Invalid,
    Conflict,
}

public sealed record MobileDeviceAdministrationResult<T>(T? Value, MobileDeviceAdministrationFailure? Failure,
    string? Code, bool Replayed = false) where T : class;

/// <summary>The outcomes of OCC's tablet commands.</summary>
public static class MobileDeviceAdministrationResult
{
    public static MobileDeviceAdministrationResult<T> Success<T>(T value, bool replayed = false) where T : class =>
        new(value, null, null, replayed);

    public static MobileDeviceAdministrationResult<T> Failed<T>(MobileDeviceAdministrationFailure failure, string code)
        where T : class => new(null, failure, code);
}

/// <summary>
/// The expected version of a tablet for OCC (2-N02): the latest binding, whether it is open and whether the
/// installation is revoked. Unlike the rowversion it does not move each time the tablet syncs, so OCC's screen
/// only goes stale when the tablet changes hands.
/// </summary>
public static class MobileDeviceBindingToken
{
    public static string Of(long? latestBindingId, bool bindingOpen, bool revoked) =>
        Convert.ToBase64String(Encoding.ASCII.GetBytes(string.Create(CultureInfo.InvariantCulture,
            $"b{latestBindingId ?? 0}.{(bindingOpen ? 1 : 0)}.{(revoked ? 1 : 0)}")));
}
