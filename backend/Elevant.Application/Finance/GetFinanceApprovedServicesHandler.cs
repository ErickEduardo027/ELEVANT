using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed class GetFinanceApprovedServicesHandler(
    IActorContextResolver actorContextResolver,
    IFinanceApprovedServicesReadStore store)
{
    public async Task<FinanceApprovedServicesResult> HandleAsync(
        GetFinanceApprovedServicesQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        cancellationToken.ThrowIfCancellationRequested();
        if (query.AccountId == Guid.Empty)
            return FinanceApprovedServicesResult.Failed(FinanceApprovedServicesFailure.Unauthorized);
        if (query.StationId == Guid.Empty ||
            !FinanceApprovedServicePolicy.IsValidWindow(query.From, query.To))
            return FinanceApprovedServicesResult.Failed(FinanceApprovedServicesFailure.InvalidRequest);

        var actor = await actorContextResolver.ResolveAsync(query.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, query.AccountId))
            return FinanceApprovedServicesResult.Failed(FinanceApprovedServicesFailure.Unauthorized);
        if (!actor!.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return FinanceApprovedServicesResult.Failed(FinanceApprovedServicesFailure.Forbidden);
        if (!actor.StationScopes.Any(scope => scope.StationId == query.StationId))
            return FinanceApprovedServicesResult.Failed(FinanceApprovedServicesFailure.NotFound);

        var data = await store.GetAsync(query.AccountId, query.StationId,
            query.From, query.To, cancellationToken);
        return data is null
            ? FinanceApprovedServicesResult.Failed(FinanceApprovedServicesFailure.NotFound)
            : FinanceApprovedServicesResult.Success(data);
    }
}
