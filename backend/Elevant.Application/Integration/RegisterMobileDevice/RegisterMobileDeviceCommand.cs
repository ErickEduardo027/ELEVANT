using Elevant.Domain.Enumerations;

namespace Elevant.Application.Integration.RegisterMobileDevice;

public sealed record RegisterMobileDeviceCommand(
    Guid AccountId,
    Guid InstallationId,
    MobilePlatform Platform,
    string AppVersion,
    string? DeviceName,
    string? OperatingSystemVersion);
