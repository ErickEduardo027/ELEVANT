namespace Elevant.Application.Integration.RegisterMobileDevice;

public enum RegisterMobileDeviceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    Conflict,
}

public sealed record RegisterMobileDeviceResult(
    MobileDeviceRegistrationData? Device,
    RegisterMobileDeviceFailure? Failure)
{
    public bool IsSuccess => Device is not null && Failure is null;

    public static RegisterMobileDeviceResult Success(MobileDeviceRegistrationData device) =>
        new(device, null);

    public static RegisterMobileDeviceResult Failed(RegisterMobileDeviceFailure failure) =>
        new(null, failure);
}
