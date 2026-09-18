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

public sealed record MobileDeviceRegistrationWriteResult(
    MobileDeviceRegistrationData? Device,
    MobileDeviceRegistrationWriteFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Device is not null && Failure is null;

    public static MobileDeviceRegistrationWriteResult Success(
        MobileDeviceRegistrationData device,
        Guid commitReceiptId) =>
        new(device, null, commitReceiptId);

    public static MobileDeviceRegistrationWriteResult Failed(
        MobileDeviceRegistrationWriteFailure failure) =>
        new(null, failure, null);
}
