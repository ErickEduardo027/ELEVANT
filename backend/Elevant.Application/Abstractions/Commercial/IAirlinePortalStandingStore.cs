using Elevant.Application.Commercial;

namespace Elevant.Application.Abstractions.Commercial;

/// <summary>The airline's standing with AVIAM for its portal (2-N32, 2-N35), scoped in SQL to its organization.</summary>
public interface IAirlinePortalStandingStore
{
    /// <summary>Null when the organization is not an active airline customer.</summary>
    Task<AirlinePortalStandingData?> GetStandingAsync(Guid organizationId, DateOnly onDate,
        CancellationToken cancellationToken = default);
}
