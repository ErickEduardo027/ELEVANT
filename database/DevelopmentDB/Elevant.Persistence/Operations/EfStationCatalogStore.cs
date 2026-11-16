using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Stations of the platform, kept by the superadministrator (2-A): a database that was never seeded, like
/// Production, starts here. The code is the airport's IATA code and never changes; the time zone changes only
/// while the station has no history; a station in use (a live contract, an unfinished flight, an open coverage or
/// a scheduled shift) is never deactivated. Nothing is deleted.
/// </summary>
internal sealed class EfStationCatalogStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider timeProvider)
    : IStationCatalogStore
{
    private const string CreateAction = "ref.station.create";
    private const string UpdateAction = "ref.station.update";
    private const string Resource = "ref.stations";

    public async Task<StationCatalogData?> ListAsync(Guid actorId, CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return null;
        var rows = await (from station in context.Stations.AsNoTracking()
                          join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
                          orderby station.Code
                          select new { Station = station, Airport = airport }).ToArrayAsync(cancellationToken);
        var history = await MasterDataUsage.StationsWithHistoryAsync(context, cancellationToken);
        var available = await context.Airports.AsNoTracking()
            .Where(airport => !context.Stations.Any(station => station.AirportId == airport.Id))
            .OrderBy(airport => airport.IataCode)
            .Select(airport => new StationAirportData(airport.PublicId, airport.IataCode, airport.IcaoCode, airport.Name,
                airport.City, airport.CountryCode))
            .ToArrayAsync(cancellationToken);
        return new StationCatalogData(
            rows.Select(row => Item(row.Station, row.Airport, history.Contains(row.Station.Id))).ToArray(), available);
    }

    public async Task<MasterDataResult<StationCatalogItemData>> CreateAsync(Guid actorId, CreateStationInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        ArgumentNullException.ThrowIfNull(input);
        var code = MasterDataRules.StationCode(input.Code);
        var name = MasterDataRules.Name(input.Name, 120);
        if (code is null || name is null) return Failed(MasterDataFailure.Invalid, "invalid_station");
        var zone = MasterDataRules.IanaTimeZone(input.IanaTimeZone);
        if (zone is null) return Failed(MasterDataFailure.Invalid, "invalid_time_zone");
        // The airport fields are optional: they only matter when the airport is not registered yet.
        var icao = Optional(input.AirportIcaoCode, MasterDataRules.AirportIcao, out var badIcao);
        var airportName = Optional(input.AirportName, value => MasterDataRules.Name(value, 180), out var badName);
        var city = Optional(input.AirportCity, value => MasterDataRules.Name(value, 120), out var badCity);
        var country = Optional(input.AirportCountryCode, MasterDataRules.CountryCode, out var badCountry);
        if (badIcao || badName || badCity || badCountry) return Failed(MasterDataFailure.Invalid, "invalid_station");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { code, name, zone, icao, airportName, city, country });
        var now = Now();

        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, CreateAction, hash, "station_code_taken", now,
            async () =>
            {
                if (await context.Stations.AnyAsync(item => item.Code == code, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "station_code_taken");
                var airport = await context.Airports.SingleOrDefaultAsync(item => item.IataCode == code, cancellationToken);
                if (airport is null)
                {
                    if (icao is null || airportName is null || city is null || country is null)
                        return Step.Fail(MasterDataFailure.Invalid, "airport_required");
                    if (await context.Airports.AnyAsync(item => item.IcaoCode == icao, cancellationToken))
                        return Step.Fail(MasterDataFailure.Conflict, "airport_icao_taken");
                    airport = new Airport
                    {
                        PublicId = Guid.CreateVersion7(), IataCode = code, IcaoCode = icao, Name = airportName, City = city,
                        CountryCode = country, IanaTimeZone = zone, CreatedAt = now, UpdatedAt = now,
                    };
                    context.Airports.Add(airport);
                    await context.SaveChangesAsync(cancellationToken);
                }
                else if (await context.Stations.AnyAsync(item => item.AirportId == airport.Id, cancellationToken))
                {
                    return Step.Fail(MasterDataFailure.Conflict, "airport_has_station");
                }
                var station = new Station
                {
                    PublicId = Guid.CreateVersion7(), AirportId = airport.Id, Code = code, Name = name, IanaTimeZone = zone,
                    IsActive = true, CreatedAt = now, UpdatedAt = now,
                };
                context.Stations.Add(station);
                await context.SaveChangesAsync(cancellationToken);
                MasterDataCommand.Audit(context, accountId, "ref.station.created", Resource, station.PublicId, station.Id, now,
                    new("station.name", null, name), new("station.time_zone", null, zone), new("station.active", null, "true"));
                return Step.Done(station.PublicId);
            }, ReadAsync, cancellationToken);
    }

    public async Task<MasterDataResult<StationCatalogItemData>> UpdateAsync(Guid actorId, Guid stationId,
        UpdateStationInput input, Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        ArgumentNullException.ThrowIfNull(input);
        if (string.IsNullOrWhiteSpace(input.ExpectedVersion)) return Failed(MasterDataFailure.Invalid, "expected_version_required");
        var name = MasterDataRules.Name(input.Name, 120);
        if (name is null) return Failed(MasterDataFailure.Invalid, "invalid_station");
        var zone = MasterDataRules.IanaTimeZone(input.IanaTimeZone);
        if (zone is null) return Failed(MasterDataFailure.Invalid, "invalid_time_zone");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { stationId, name, zone, input.IsActive, expected = input.ExpectedVersion });
        var now = Now();

        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, UpdateAction, hash, "version_conflict", now,
            async () =>
            {
                var station = await context.Stations.SingleOrDefaultAsync(item => item.PublicId == stationId, cancellationToken);
                if (station is null) return Step.Fail(MasterDataFailure.NotFound, "not_found");
                if (MasterDataCommand.Version(station.RowVersion) != input.ExpectedVersion)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                if (zone != station.IanaTimeZone &&
                    (await MasterDataUsage.StationsWithHistoryAsync(context, cancellationToken)).Contains(station.Id))
                    return Step.Fail(MasterDataFailure.Conflict, "time_zone_locked");
                // Contracts, unfinished flights, open coverages and scheduled shifts keep it active: OCC would lose them.
                var today = BusinessCalendar.Today(now, station.IanaTimeZone);
                if (station.IsActive && !input.IsActive &&
                    await MasterDataUsage.StationInUseAsync(context, station.Id, today, now, cancellationToken))
                    return Step.Fail(MasterDataFailure.Conflict, "station_in_use");
                if (station.Name == name && station.IanaTimeZone == zone && station.IsActive == input.IsActive)
                    return Step.Done(station.PublicId);
                MasterDataCommand.Audit(context, accountId, MasterDataCommand.Event("ref.station", station.IsActive, input.IsActive),
                    Resource, station.PublicId, station.Id, now,
                    new("station.name", station.Name, name), new("station.time_zone", station.IanaTimeZone, zone),
                    new("station.active", Flag(station.IsActive), Flag(input.IsActive)));
                (station.Name, station.IanaTimeZone, station.IsActive, station.UpdatedAt) = (name, zone, input.IsActive, now);
                // OCC screens of the station read it again: an inactive station leaves their scope.
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(station.PublicId);
            }, ReadAsync, cancellationToken);
    }

    private async Task<StationCatalogItemData?> ReadAsync(Guid stationId)
    {
        var row = await (from station in context.Stations.AsNoTracking()
                         join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
                         where station.PublicId == stationId
                         select new { Station = station, Airport = airport }).SingleOrDefaultAsync();
        if (row is null) return null;
        var history = await MasterDataUsage.StationsWithHistoryAsync(context, CancellationToken.None);
        return Item(row.Station, row.Airport, history.Contains(row.Station.Id));
    }

    private static StationCatalogItemData Item(Station station, Airport airport, bool hasHistory) =>
        new(station.PublicId, station.Code, station.Name, station.IanaTimeZone, station.IsActive, hasHistory,
            new StationAirportData(airport.PublicId, airport.IataCode, airport.IcaoCode, airport.Name, airport.City,
                airport.CountryCode), MasterDataCommand.Version(station.RowVersion));

    private static string? Optional(string? value, Func<string?, string?> normalize, out bool invalid)
    {
        invalid = false;
        if (string.IsNullOrWhiteSpace(value)) return null;
        var normalized = normalize(value);
        invalid = normalized is null;
        return normalized;
    }

    private async Task<bool> IsSuperAdministratorAsync(Guid actorId, CancellationToken cancellationToken) =>
        (await actors.ResolveAsync(actorId, cancellationToken))?.EffectiveAccess?.IsSuperAdministrator == true;

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private DateTimeOffset Now()
    {
        var value = timeProvider.GetUtcNow();
        return new DateTimeOffset(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);
    }

    private static string Flag(bool value) => value ? "true" : "false";

    private static MasterDataResult<StationCatalogItemData> Failed(MasterDataFailure failure, string code) =>
        MasterDataResult<StationCatalogItemData>.Failed(failure, code);
}
