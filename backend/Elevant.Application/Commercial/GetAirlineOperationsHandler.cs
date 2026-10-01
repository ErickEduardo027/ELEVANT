using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

public sealed class GetAirlineOperationsHandler(
    IActorContextResolver actors, IAirlinePortalReadStore operations)
{
    public async Task<AirlineOperationPageResult> HandleAsync(
        Guid accountId, int page, int limit, CancellationToken cancellationToken = default)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(page, 1);
        if (limit is < 1 or > 50) throw new ArgumentOutOfRangeException(nameof(limit));

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return AirlineOperationPageResult.Failed(failure.Value);

        var result = await operations.GetOperationsAsync(
            organizationId!.Value, page, limit, cancellationToken);
        return result is null
            ? AirlineOperationPageResult.Failed(AirlinePortalFailure.NotFound)
            : AirlineOperationPageResult.Success(result);
    }
}
