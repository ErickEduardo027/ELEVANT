using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Published contract rates for a Finance actor's live station scope; never reprices history.</summary>
internal sealed class EfFinanceTariffReadStore(
    ElevantDbContext context, TimeProvider timeProvider) : IFinanceTariffReadStore
{
    public async Task<FinanceTariffPageData?> ListAsync(Guid accountId, Guid stationId,
        int page, int limit, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || stationId == Guid.Empty || page < 1 ||
            limit is < 1 or > 50 || (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));

        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from account in context.Users.AsNoTracking()
            from station in context.Stations.AsNoTracking()
            where account.PublicId == accountId && station.PublicId == stationId &&
                  station.IsActive && context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { AccountId = account.Id, StationId = station.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return null;

        var rows = await (
            from coverage in context.Set<ContractVersionStation>().AsNoTracking()
            join version in context.ContractVersions.AsNoTracking()
                on coverage.ContractVersionId equals version.Id
            join contract in context.Contracts.AsNoTracking()
                on version.ContractId equals contract.Id
            join airline in context.Airlines.AsNoTracking()
                on contract.AirlineId equals airline.Id
            join rate in context.ContractServiceRates.AsNoTracking()
                on version.Id equals rate.ContractVersionId
            join service in context.ServiceDefinitions.AsNoTracking()
                on rate.ServiceDefinitionId equals service.Id
            where coverage.StationId == scope.StationId &&
                  (version.Status == ContractVersionStatus.Approved ||
                   version.Status == ContractVersionStatus.Superseded) &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == scope.AccountId && grant.StationId == coverage.StationId &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            orderby contract.ContractCode, version.VersionNumber descending, service.Code, rate.Id
            select new
            {
                Id = rate.PublicId, ContractId = contract.PublicId, contract.ContractCode,
                AirlineId = airline.PublicId, AirlineName = airline.Name,
                version.VersionNumber, version.Status, version.ValidFrom, version.ValidTo,
                version.CurrencyCode, ServiceCode = service.Code, ServiceName = service.Name,
                rate.BillingUnit, rate.UnitPrice, rate.MinimumQuantity,
            }).Skip((page - 1) * limit).Take(limit + 1).ToArrayAsync(cancellationToken);

        return new FinanceTariffPageData(stationId, page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new FinanceTariffData(row.Id,
                row.ContractId, row.ContractCode, row.AirlineId, row.AirlineName,
                row.VersionNumber, row.Status.ToString(), row.ValidFrom, row.ValidTo,
                row.CurrencyCode, row.ServiceCode, row.ServiceName, row.BillingUnit,
                row.UnitPrice, row.MinimumQuantity)).ToArray());
    }
}
