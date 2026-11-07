using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Integration;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RegisterMobileDeviceRequest
{
    public RegisterMobileDeviceRequest(
        Guid installationId,
        string platform,
        string appVersion,
        string? deviceName,
        string? operatingSystemVersion)
    {
        InstallationId = installationId;
        Platform = platform;
        AppVersion = appVersion;
        DeviceName = deviceName;
        OperatingSystemVersion = operatingSystemVersion;
    }

    [Required]
    public Guid InstallationId { get; init; }

    [Required]
    [RegularExpression("^(Android|Ios)$")]
    public string Platform { get; init; }

    [Required]
    [StringLength(32, MinimumLength = 1)]
    public string AppVersion { get; init; }

    [StringLength(120, MinimumLength = 1)]
    public string? DeviceName { get; init; }

    [StringLength(64, MinimumLength = 1)]
    public string? OperatingSystemVersion { get; init; }
}

/// <summary>The tablet frees its binding when the agent signs out (2-N02); the next agent binds it at sign-in.</summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ReleaseMobileDeviceRequest
{
    public ReleaseMobileDeviceRequest(Guid installationId)
    {
        InstallationId = installationId;
    }

    [Required]
    public Guid InstallationId { get; init; }
}

public sealed record RegisterMobileDeviceResponse
{
    public RegisterMobileDeviceResponse(
        Guid installationId,
        string platform,
        string appVersion,
        DateTimeOffset lastSeenAt)
    {
        InstallationId = installationId;
        Platform = platform;
        AppVersion = appVersion;
        LastSeenAt = lastSeenAt;
    }

    public Guid InstallationId { get; init; }

    [RegularExpression("^(Android|Ios)$")]
    public string Platform { get; init; }

    [StringLength(32, MinimumLength = 1)]
    public string AppVersion { get; init; }

    public DateTimeOffset LastSeenAt { get; init; }
}
