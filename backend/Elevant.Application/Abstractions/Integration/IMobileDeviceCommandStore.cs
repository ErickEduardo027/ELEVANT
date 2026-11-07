using Elevant.Application.Integration;

namespace Elevant.Application.Abstractions.Integration;

/// <summary>Registers a mobile installation against the current server-owned account.</summary>
public interface IMobileDeviceCommandStore
{
    /// <summary>
    /// Binds the installation to the account. A tablet held by another agent passes to this one unless that agent
    /// has an operation in progress (2-N02); a revoked installation never registers again.
    /// </summary>
    Task<MobileDeviceRegistrationWriteResult> RegisterAsync(
        MobileDeviceRegistrationWriteRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>The account that holds the tablet frees it when it signs out (2-N02).</summary>
    Task<MobileDeviceReleaseWriteResult> ReleaseAsync(
        MobileDeviceReleaseWriteRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// OCC's view of the shared tablets (2-N02) under <c>operations.devices.*</c>: who holds each one, freeing a tablet
/// and revoking a lost one. Every command takes an Idempotency-Key and the binding token on screen.
/// </summary>
public interface IMobileDeviceAdministrationStore
{
    Task<MobileDeviceAdministrationResult<OccMobileDevicesData>> ListAsync(Guid actorId, Guid stationId,
        CancellationToken cancellationToken = default);

    Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> UnbindAsync(Guid actorId, Guid deviceId,
        UnbindMobileDeviceInput input, Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<MobileDeviceAdministrationResult<OccMobileDeviceData>> RevokeAsync(Guid actorId, Guid deviceId,
        RevokeMobileDeviceInput input, Guid idempotencyKey, CancellationToken cancellationToken = default);
}
