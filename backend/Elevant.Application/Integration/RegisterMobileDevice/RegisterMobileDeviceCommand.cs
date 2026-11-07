using Elevant.Domain.Enumerations;

namespace Elevant.Application.Integration.RegisterMobileDevice;

/// <summary>
/// The tablet registers for its agent. <paramref name="SessionStartedAt"/> is when the agent's session began (the
/// access token's <c>iat</c>, see <see cref="MobileDeviceSession"/>).
/// </summary>
public sealed record RegisterMobileDeviceCommand(
    Guid AccountId,
    Guid InstallationId,
    MobilePlatform Platform,
    string AppVersion,
    string? DeviceName,
    string? OperatingSystemVersion,
    DateTimeOffset? SessionStartedAt = null);
