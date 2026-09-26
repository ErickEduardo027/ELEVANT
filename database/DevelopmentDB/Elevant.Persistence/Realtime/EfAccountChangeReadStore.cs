using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Realtime;

/// <summary>Rechecks the actor and live station scope on every feed page.</summary>
internal sealed class EfAccountChangeReadStore(
    ElevantDbContext context,
    IActorContextResolver actors) : IAccountChangeReadStore
{
    public async Task<AccountChangePage?> ReadAsync(Guid accountId, long after, int limit,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || after < 0 || limit is < 1 or > 100)
            throw new ArgumentOutOfRangeException(nameof(limit));

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (actor is null || actor.Roles.Count == 0 || actor.Memberships.Count == 0)
            return null;

        var accountInternalId = await context.Users.AsNoTracking()
            .Where(account => account.PublicId == accountId)
            .Select(account => account.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (accountInternalId <= 0)
            return null;

        var allowedStations = actor.StationScopes
            .Select(scope => scope.StationId)
            .ToArray();
        var airlineOrganizationIds = actor.Memberships
            .Where(membership => membership.Kind == MembershipKind.AirlineClient &&
                membership.OrganizationType == OrganizationType.AirlineCustomer)
            .Select(membership => membership.OrganizationId)
            .ToArray();
        var hasAirlinePortalRole = actor.Roles.Any(role =>
            role.Code == "AIRLINE_CLIENT" && role.Portal == PortalKind.AirlinePortal);
        var hasFinanceAccess = actor.Roles.Any(role =>
            role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) &&
            actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator);
        var rows = await context.AccountChanges.AsNoTracking()
            .Where(change => change.RecipientAccountId == accountInternalId &&
                change.Id > after &&
                (change.StationId == null || context.Stations.Any(station =>
                    station.Id == change.StationId &&
                    allowedStations.Contains(station.PublicId))) &&
                (change.Resource != "finance_approved_services" ||
                    (hasFinanceAccess && change.StationId != null &&
                     context.GroundOperations.Any(operation =>
                         operation.PublicId == change.ResourceId &&
                         operation.CurrentStatus == GroundOperationStatus.Approved &&
                         context.Turnarounds.Any(turnaround =>
                             turnaround.Id == operation.TurnaroundId &&
                             turnaround.StationId == change.StationId)))) &&
                (change.Resource != "finance_preinvoices" ||
                    (hasFinanceAccess && change.StationId != null &&
                     context.Preinvoices.Any(draft =>
                         draft.PublicId == change.ResourceId &&
                         draft.StationId == change.StationId))) &&
                (change.Resource != "airline_operations" ||
                    (hasAirlinePortalRole && context.GroundOperations.Any(operation =>
                        operation.PublicId == change.ResourceId &&
                        context.Turnarounds.Any(turnaround =>
                            turnaround.Id == operation.TurnaroundId &&
                            context.Airlines.Any(airline =>
                                airline.Id == turnaround.AirlineId &&
                                context.Organizations.Any(organization =>
                                    organization.Id == airline.OrganizationId &&
                                    airlineOrganizationIds.Contains(organization.PublicId))))))))
            .OrderBy(change => change.Id)
            .Take(limit + 1)
            .Select(change => new AccountChangeData(
                change.PublicId, change.Id, change.Resource,
                change.ResourceId, change.OccurredAt))
            .ToArrayAsync(cancellationToken);
        return new AccountChangePage(rows.Take(limit).ToArray(), rows.Length > limit);
    }
}
