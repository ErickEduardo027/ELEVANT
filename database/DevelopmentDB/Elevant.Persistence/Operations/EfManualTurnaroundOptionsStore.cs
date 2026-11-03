using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>Lists only current contractual choices for a live scoped OCC actor.</summary>
internal sealed class EfManualTurnaroundOptionsStore(
    ElevantDbContext context,
    TimeProvider timeProvider) : IManualTurnaroundOptionsStore
{
    public async Task<ManualTurnaroundOptionsData?> GetAsync(
        Guid accountId, Guid stationId, DateOnly operationDate,
        CancellationToken cancellationToken = default)
    {
        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("operations.planning.create") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;

        var now = timeProvider.GetUtcNow();
        var station = await (
            from item in context.Stations.AsNoTracking()
            join airport in context.Airports.AsNoTracking() on item.AirportId equals airport.Id
            join account in context.Users.AsNoTracking() on accountId equals account.PublicId
            where item.PublicId == stationId && item.IsActive &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == item.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new
            {
                item.Id,
                Station = new OccStationData(item.PublicId, item.Code, item.Name, item.IanaTimeZone),
                Airport = new OccAirportData(airport.PublicId, airport.IataCode,
                    airport.IcaoCode, airport.Name),
            }).SingleOrDefaultAsync(cancellationToken);
        if (station is null) return null;

        var contracted = await (
            from row in ApplicableContracts.For(context, null, station.Id, operationDate)
            join airline in context.Airlines.AsNoTracking() on row.AirlineId equals airline.Id
            where airline.IsActive
            orderby airline.Name, airline.PublicId
            select new { airline.PublicId, airline.IataCode, airline.Name, row.VersionId })
            .ToArrayAsync(cancellationToken);
        var airlines = contracted.GroupBy(item => item.PublicId)
            .Where(group => group.Count() == 1)
            .Select(group => group.Single())
            .Select(item => new ManualTurnaroundAirlineData(item.PublicId,
                item.IataCode, item.Name))
            .ToArray();

        var airports = await context.Airports.AsNoTracking()
            .OrderBy(item => item.IataCode)
            .Select(item => new OccAirportData(item.PublicId, item.IataCode,
                item.IcaoCode, item.Name))
            .ToArrayAsync(cancellationToken);

        var stands = await (
            from stand in context.Stands.AsNoTracking()
            join terminal in context.Terminals.AsNoTracking()
                on stand.TerminalId equals (long?)terminal.Id
            where stand.StationId == station.Id && stand.IsActive &&
                  terminal.StationId == station.Id && terminal.IsActive
            orderby terminal.Code, stand.Code
            select new OccStandData(stand.PublicId, stand.Code,
                new OccTerminalData(terminal.PublicId, terminal.Code, terminal.Name)))
            .ToArrayAsync(cancellationToken);

        return new ManualTurnaroundOptionsData(station.Station, operationDate,
            station.Airport, airlines, airports, stands);
    }
}
