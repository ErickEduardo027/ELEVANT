using Elevant.Application.Commercial;

namespace Elevant.Application.Abstractions.Commercial;

/// <summary>Reads airline portal scope from active contracts, never from browser claims.</summary>
public interface IAirlinePortalReadStore
{
    Task<AirlinePortalBootstrapData?> GetBootstrapAsync(
        Guid organizationId,
        DateOnly onDate,
        CancellationToken cancellationToken = default);

    Task<AirlineContractPageData?> GetContractsAsync(
        Guid organizationId,
        int page,
        int limit,
        CancellationToken cancellationToken = default);

    Task<AirlineOperationPageData?> GetOperationsAsync(
        Guid organizationId,
        int page,
        int limit,
        CancellationToken cancellationToken = default);

    Task<AirlinePortalOperationData?> GetOperationAsync(
        Guid organizationId,
        Guid operationId,
        CancellationToken cancellationToken = default);

    Task<AirlineOperationalRequestPageData?> GetRequestsAsync(
        Guid organizationId,
        int page,
        int limit,
        CancellationToken cancellationToken = default);
}
