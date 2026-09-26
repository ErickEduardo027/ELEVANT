using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

public sealed class GetAirlineContractsHandler(
    IActorContextResolver actors, IAirlinePortalReadStore contracts)
{
    public async Task<AirlineContractPageResult> HandleAsync(
        Guid accountId, int page, int limit, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(page, 1);
        if (limit is < 1 or > 50) throw new ArgumentOutOfRangeException(nameof(limit));

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return AirlineContractPageResult.Failed(failure.Value);

        var result = await contracts.GetContractsAsync(
            organizationId!.Value, page, limit, cancellationToken);
        return result is null
            ? AirlineContractPageResult.Failed(AirlinePortalFailure.NotFound)
            : AirlineContractPageResult.Success(result);
    }
}
