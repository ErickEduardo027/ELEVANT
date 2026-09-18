using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Identity;
using Elevant.Application.Operations;

namespace Elevant.Application.Integration.RegisterMobileDevice;

public sealed class RegisterMobileDeviceHandler(
    IActorContextResolver actorContextResolver,
    IMobileDeviceCommandStore commandStore)
{
    private const int MaximumAppVersionLength = 32;
    private const int MaximumDeviceNameLength = 120;
    private const int MaximumOperatingSystemVersionLength = 64;

    public async Task<RegisterMobileDeviceResult> HandleAsync(
        RegisterMobileDeviceCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();

        if (command.AccountId == Guid.Empty)
        {
            return RegisterMobileDeviceResult.Failed(
                RegisterMobileDeviceFailure.Unauthorized);
        }

        var appVersion = NormalizeRequired(command.AppVersion);
        var deviceName = NormalizeOptional(command.DeviceName);
        var operatingSystemVersion = NormalizeOptional(command.OperatingSystemVersion);
        if (command.InstallationId == Guid.Empty ||
            !Enum.IsDefined(command.Platform) ||
            appVersion is null ||
            appVersion.Length > MaximumAppVersionLength ||
            deviceName?.Length > MaximumDeviceNameLength ||
            operatingSystemVersion?.Length > MaximumOperatingSystemVersionLength)
        {
            return RegisterMobileDeviceResult.Failed(
                RegisterMobileDeviceFailure.InvalidRequest);
        }

        var actor = await actorContextResolver.ResolveAsync(
            command.AccountId,
            cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
        {
            return RegisterMobileDeviceResult.Failed(
                RegisterMobileDeviceFailure.Unauthorized);
        }

        if (!RampOperationsAccess.IsAuthorized(actor!))
        {
            return RegisterMobileDeviceResult.Failed(
                RegisterMobileDeviceFailure.Forbidden);
        }

        var result = await commandStore.RegisterAsync(
            new MobileDeviceRegistrationWriteRequest(
                command.AccountId,
                command.InstallationId,
                command.Platform,
                appVersion,
                deviceName,
                operatingSystemVersion),
            cancellationToken);

        return result.IsSuccess
            ? RegisterMobileDeviceResult.Success(result.Device!)
            : RegisterMobileDeviceResult.Failed(result.Failure switch
            {
                MobileDeviceRegistrationWriteFailure.Forbidden =>
                    RegisterMobileDeviceFailure.Forbidden,
                MobileDeviceRegistrationWriteFailure.Conflict =>
                    RegisterMobileDeviceFailure.Conflict,
                _ => throw new InvalidOperationException(
                    "Unsupported mobile device registration failure."),
            });
    }

    private static string? NormalizeRequired(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }

    private static string? NormalizeOptional(string? value)
    {
        var normalized = value?.Trim();
        return string.IsNullOrEmpty(normalized) ? null : normalized;
    }
}
