namespace Elevant.Application.Integration.RegisterMobileDevice;

public enum RegisterMobileDeviceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    Conflict,
}

/// <summary>
/// Outcome of a registration; <paramref name="Code"/> is the Problem Details code of a refusal the tablet explains
/// (<see cref="MobileDeviceCodes"/>).
/// </summary>
public sealed record RegisterMobileDeviceResult(
    MobileDeviceRegistrationData? Device,
    RegisterMobileDeviceFailure? Failure,
    string? Code = null)
{
    public bool IsSuccess => Device is not null && Failure is null;

    public static RegisterMobileDeviceResult Success(MobileDeviceRegistrationData device) =>
        new(device, null);

    public static RegisterMobileDeviceResult Failed(RegisterMobileDeviceFailure failure, string? code = null) =>
        new(null, failure, code);
}
