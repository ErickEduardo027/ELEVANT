using Elevant.Application.Integration;

namespace Elevant.Application.Abstractions.Integration;

/// <summary>Registers a mobile installation against the current server-owned account.</summary>
public interface IMobileDeviceCommandStore
{
    Task<MobileDeviceRegistrationWriteResult> RegisterAsync(
        MobileDeviceRegistrationWriteRequest request,
        CancellationToken cancellationToken = default);
}
