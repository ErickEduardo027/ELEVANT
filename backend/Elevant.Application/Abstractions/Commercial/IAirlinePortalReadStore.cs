using Elevant.Application.Commercial;

namespace Elevant.Application.Abstractions.Commercial;

/// <summary>Reads airline portal scope from active contracts, never from browser claims.</summary>
public interface IAirlinePortalReadStore
{
    Task<AirlinePortalBootstrapData?> GetBootstrapAsync(
        Guid organizationId,
        DateOnly onDate,
        CancellationToken cancellationToken = default);
}
