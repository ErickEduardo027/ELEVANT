using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Integration;

/// <summary>Usage ledger, lease and ingestion of the paid flight feed (ADR-0028).</summary>
internal sealed class EfFlightFeedSyncStore(ElevantDbContext context, IActorContextResolver actors) : IFlightFeedSyncStore
{
    public const string FidsOperation = "fids";
    public const string RegistrySource = "AeroDataBox";

    public async Task<bool> TryAcquireLeaseAsync(string provider, Guid holder, DateTimeOffset now, DateTimeOffset until,
        CancellationToken cancellationToken = default)
    {
        var updated = await context.Set<ProviderSyncLease>()
            .Where(lease => lease.Provider == provider &&
                (lease.LeasedUntil == null || lease.LeasedUntil <= now || lease.HolderId == holder))
            .ExecuteUpdateAsync(update => update.SetProperty(lease => lease.HolderId, holder)
                .SetProperty(lease => lease.LeasedUntil, until).SetProperty(lease => lease.UpdatedAt, now), cancellationToken);
        if (updated == 1) return true;
        if (await context.Set<ProviderSyncLease>().AsNoTracking().AnyAsync(lease => lease.Provider == provider, cancellationToken))
            return false;
        // First use of the provider: the row is created by code, never by a migration.
        context.Set<ProviderSyncLease>().Add(new ProviderSyncLease
        {
            PublicId = Guid.CreateVersion7(), Provider = provider, HolderId = holder, LeasedUntil = until,
            CreatedAt = now, UpdatedAt = now,
        });
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return false;
        }
    }

    public Task ReleaseLeaseAsync(string provider, Guid holder, CancellationToken cancellationToken = default) =>
        context.Set<ProviderSyncLease>().Where(lease => lease.Provider == provider && lease.HolderId == holder)
            .ExecuteUpdateAsync(update => update.SetProperty(lease => lease.HolderId, (Guid?)null)
                .SetProperty(lease => lease.LeasedUntil, (DateTimeOffset?)null), cancellationToken);

    public async Task<FlightFeedProviderState> GetStateAsync(string provider, DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var lease = await context.Set<ProviderSyncLease>().AsNoTracking().Where(item => item.Provider == provider)
            .Select(item => new { item.PausedUntil, item.ConsecutiveFailures, item.LastError })
            .SingleOrDefaultAsync(cancellationToken);
        var (dayStart, monthStart) = UsagePeriods(now);
        var entries = context.Set<ProviderUsageEntry>().AsNoTracking().Where(entry => entry.Provider == provider);
        var month = await entries.Where(entry => entry.OccurredAt >= monthStart).SumAsync(entry => entry.Units, cancellationToken);
        var today = await entries.Where(entry => entry.OccurredAt >= dayStart).SumAsync(entry => entry.Units, cancellationToken);
        return new FlightFeedProviderState(lease?.PausedUntil, lease?.ConsecutiveFailures ?? 0, lease?.LastError, today, month);
    }

    /// <summary>Budgets count UTC days and UTC calendar months.</summary>
    public static (DateTimeOffset DayStart, DateTimeOffset MonthStart) UsagePeriods(DateTimeOffset now)
    {
        var utc = now.UtcDateTime;
        return (new DateTimeOffset(utc.Date, TimeSpan.Zero), new DateTimeOffset(utc.Year, utc.Month, 1, 0, 0, 0, TimeSpan.Zero));
    }

    public async Task SetPauseAsync(string provider, DateTimeOffset? pausedUntil, int consecutiveFailures, string? lastError,
        CancellationToken cancellationToken = default)
    {
        var updated = await context.Set<ProviderSyncLease>().Where(lease => lease.Provider == provider)
            .ExecuteUpdateAsync(update => update.SetProperty(lease => lease.PausedUntil, pausedUntil)
                .SetProperty(lease => lease.ConsecutiveFailures, consecutiveFailures)
                .SetProperty(lease => lease.LastError, lastError), cancellationToken);
        if (updated == 1) return;
        var now = DateTimeOffset.UtcNow;
        context.Set<ProviderSyncLease>().Add(new ProviderSyncLease
        {
            PublicId = Guid.CreateVersion7(), Provider = provider, PausedUntil = pausedUntil,
            ConsecutiveFailures = consecutiveFailures, LastError = lastError, CreatedAt = now, UpdatedAt = now,
        });
        await context.SaveChangesAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<FlightFeedStation>> ListStationsAsync(DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var stations = await StationsQuery().ToArrayAsync(cancellationToken);
        var result = new List<FlightFeedStation>();
        foreach (var station in stations)
        {
            var today = LocalDate(now, station.TimeZoneId);
            if (await HasContractsAsync(station.StationId, today, cancellationToken) ||
                await HasContractsAsync(station.StationId, today.AddDays(1), cancellationToken))
                result.Add(station);
        }
        return result;
    }

    public async Task<FlightFeedStationActivity> GetActivityAsync(string provider, FlightFeedStation station, DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZoneId);
        var today = LocalDate(now, station.TimeZoneId);
        var contractedAirlines = await ApplicableContracts.For(context, null, station.StationId, today)
            .Select(row => row.AirlineId).Distinct().ToArrayAsync(cancellationToken);
        var proposalTimes = await context.Set<ExternalFlightProposal>().AsNoTracking()
            .Where(proposal => proposal.StationId == station.StationId && proposal.OperationDate == today &&
                proposal.Status != ExternalFlightProposalStatus.Dismissed && contractedAirlines.Contains(proposal.AirlineId))
            .Select(proposal => proposal.RevisedAt ?? proposal.ScheduledAt).ToArrayAsync(cancellationToken);
        var legTimes = await (from turnaround in context.Turnarounds.AsNoTracking()
                              join leg in context.FlightLegs.AsNoTracking() on turnaround.Id equals leg.TurnaroundId
                              where turnaround.StationId == station.StationId && turnaround.OperationDate == today &&
                                    turnaround.CurrentStatus != TurnaroundStatus.Cancelled
                              select leg.EstimatedAt ?? leg.ScheduledAt).ToArrayAsync(cancellationToken);
        var since = now.AddHours(-48);
        var usage = await context.Set<ProviderUsageEntry>().AsNoTracking()
            .Where(entry => entry.Provider == provider && entry.StationId == station.StationId && entry.OccurredAt >= since)
            .Select(entry => new { entry.WindowFrom, entry.WindowTo, entry.OccurredAt, entry.Outcome, entry.Trigger })
            .ToArrayAsync(cancellationToken);
        var fetches = usage
            .Where(entry => entry.WindowFrom != null &&
                entry.Outcome is ProviderCallOutcome.Succeeded or ProviderCallOutcome.NoContent)
            .Select(entry => new FlightFeedFetch(TimeZoneInfo.ConvertTime(entry.WindowFrom!.Value, zone).DateTime,
                TimeZoneInfo.ConvertTime(entry.WindowTo!.Value, zone).DateTime, entry.OccurredAt))
            .ToArray();
        var lastManual = usage.Where(entry => entry.Trigger == ProviderCallTrigger.Manual)
            .Select(entry => (DateTimeOffset?)entry.OccurredAt).Max();
        return new FlightFeedStationActivity(contractedAirlines.Length > 0,
            await HasContractsAsync(station.StationId, today.AddDays(1), cancellationToken),
            [.. proposalTimes, .. legTimes], fetches, lastManual);
    }

    public async Task<FlightFeedIngestResult> RecordAsync(FlightFeedCall call, AirportFeedResponse response,
        CancellationToken cancellationToken = default)
    {
        context.ChangeTracker.Clear();
        var zone = TimeZoneInfo.FindSystemTimeZoneById(call.Station.TimeZoneId);
        var requestedBy = call.RequestedBy is { } actor
            ? await context.Users.AsNoTracking().Where(user => user.PublicId == actor).Select(user => (long?)user.Id)
                .SingleOrDefaultAsync(cancellationToken)
            : null;
        context.Set<ProviderUsageEntry>().Add(new ProviderUsageEntry
        {
            PublicId = Guid.CreateVersion7(), Provider = call.Provider, Operation = FidsOperation,
            StationId = call.Station.StationId,
            WindowFrom = Utc(call.FromLocal, zone), WindowTo = Utc(call.ToLocal, zone),
            Units = response.Units, HttpStatus = response.HttpStatus, Outcome = response.Outcome, Trigger = call.Trigger,
            RequestedByAccountId = requestedBy, OccurredAt = call.OccurredAt, FlightsReceived = response.Flights.Count,
            CreatedAt = call.OccurredAt, UpdatedAt = call.OccurredAt,
        });
        if (response.Outcome != ProviderCallOutcome.Succeeded || response.Flights.Count == 0)
        {
            await context.SaveChangesAsync(cancellationToken);
            return new FlightFeedIngestResult(response.Flights.Count, 0, 0, 0, 0, 0);
        }

        // Only the paid provider's answers feed the observed registry: the simulated feed (2-B) reports
        // airlines that are already registered.
        var airlinesSeen = call.Provider == RegistrySource
            ? await HarvestAirlinesAsync(call, response.Flights, cancellationToken)
            : 0;
        var (airports, airportsAdded) = await HarvestAirportsAsync(call, response.Flights, cancellationToken);
        var (contracted, created, updatedLegs) = await IngestProposalsAsync(call, zone, response.Flights, airports, cancellationToken);
        if (created + updatedLegs > 0 || contracted > 0)
            await OccPlanningChangeWriter.AddForStationAsync(context, call.Station.StationId, call.Station.StationPublicId,
                call.OccurredAt, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return new FlightFeedIngestResult(response.Flights.Count, contracted, created, updatedLegs, airlinesSeen, airportsAdded);
    }

    /// <summary>Every airline in the answer, contracted or not, feeds the local registry for free.</summary>
    private async Task<int> HarvestAirlinesAsync(FlightFeedCall call, IReadOnlyList<FeedFlight> flights,
        CancellationToken cancellationToken)
    {
        var seen = flights.Where(flight => flight.Airline is { } airline && (airline.IataCode ?? airline.IcaoCode) is not null)
            .Select(flight => flight.Airline!)
            .GroupBy(RegistryKey).Select(group => group.First()).ToArray();
        if (seen.Length == 0) return 0;
        var keys = seen.Select(RegistryKey).ToArray();
        var existing = await context.Set<AirlineRegistryEntry>().Where(entry => keys.Contains(entry.RegistryKey))
            .ToDictionaryAsync(entry => entry.RegistryKey, cancellationToken);
        foreach (var airline in seen)
        {
            var name = Trim(airline.Name, 180)!;
            if (existing.TryGetValue(RegistryKey(airline), out var entry))
            {
                entry.Name = name;
                entry.LastSeenAt = call.OccurredAt;
                entry.UpdatedAt = call.OccurredAt;
                continue;
            }
            context.Set<AirlineRegistryEntry>().Add(new AirlineRegistryEntry
            {
                PublicId = Guid.CreateVersion7(), RegistryKey = RegistryKey(airline), IataCode = airline.IataCode,
                IcaoCode = airline.IcaoCode, Name = name, Source = RegistrySource, FirstSeenAt = call.OccurredAt,
                LastSeenAt = call.OccurredAt, CreatedAt = call.OccurredAt, UpdatedAt = call.OccurredAt,
            });
        }
        return seen.Length;
    }

    public static string RegistryKey(FeedAirline airline) => $"{airline.IataCode}|{airline.IcaoCode}";

    /// <summary>
    /// The other airport of each leg comes in the same answer: it is added to <c>ref.airports</c>
    /// when it has IATA, ICAO and country codes, and its time zone and position fill empty fields.
    /// </summary>
    private async Task<(Dictionary<string, Airport> Airports, int Added)> HarvestAirportsAsync(FlightFeedCall call,
        IReadOnlyList<FeedFlight> flights, CancellationToken cancellationToken)
    {
        var seen = flights.Select(flight => flight.Counterpart)
            .Where(airport => airport is { IataCode: not null })
            .GroupBy(airport => airport!.IataCode!).Select(group => group.First()!).ToArray();
        var codes = seen.Select(airport => airport.IataCode!).ToArray();
        var known = await context.Airports.Where(airport => codes.Contains(airport.IataCode))
            .ToDictionaryAsync(airport => airport.IataCode, cancellationToken);
        var added = 0;
        foreach (var airport in seen)
        {
            if (known.TryGetValue(airport.IataCode!, out var row))
            {
                if (row.IanaTimeZone is null && airport.TimeZone is { } zone) row.IanaTimeZone = Trim(zone, 64);
                if (row.Latitude is null && airport.Latitude is { } lat && airport.Longitude is { } lon && Valid(lat, lon))
                    (row.Latitude, row.Longitude) = (Math.Round(lat, 6), Math.Round(lon, 6));
                continue;
            }
            if (airport.IcaoCode is null || airport.CountryCode is null) continue;
            if (await context.Airports.AsNoTracking().AnyAsync(item => item.IcaoCode == airport.IcaoCode, cancellationToken)) continue;
            var created = new Airport
            {
                PublicId = Guid.CreateVersion7(), IataCode = airport.IataCode!, IcaoCode = airport.IcaoCode,
                Name = Trim(airport.Name, 180)!, City = Trim(airport.City ?? airport.Name, 120)!,
                CountryCode = airport.CountryCode, IanaTimeZone = Trim(airport.TimeZone, 64),
                Latitude = airport.Latitude is { } lat2 && airport.Longitude is { } lon2 && Valid(lat2, lon2) ? Math.Round(lat2, 6) : null,
                Longitude = airport.Latitude is { } lat3 && airport.Longitude is { } lon3 && Valid(lat3, lon3) ? Math.Round(lon3, 6) : null,
                CreatedAt = call.OccurredAt, UpdatedAt = call.OccurredAt,
            };
            context.Airports.Add(created);
            known[created.IataCode] = created;
            added++;
        }
        return (known, added);
    }

    /// <summary>
    /// Keeps the legs of every active registered airline (2-B): those with a contract covering their date at
    /// the station and, at no extra cost because they come in the same answer, the rest, which OCC reviews as
    /// charter candidates or never sees while the contract at the station is suspended or expired (2-N16). The
    /// rest of the answer is discarded. New legs become proposals; known ones refresh their times, and a
    /// confirmed leg takes the estimated and actual times with it. Only contracted legs are counted.
    /// </summary>
    private async Task<(int Contracted, int Created, int UpdatedLegs)> IngestProposalsAsync(FlightFeedCall call,
        TimeZoneInfo zone, IReadOnlyList<FeedFlight> flights, Dictionary<string, Airport> airports,
        CancellationToken cancellationToken)
    {
        var byDate = flights.Where(flight => flight.Airline is not null && !flight.IsCargo)
            .GroupBy(flight => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(flight.ScheduledUtc, zone).DateTime))
            .ToArray();
        if (byDate.Length == 0) return (0, 0, 0);
        var registered = await context.Airlines.AsNoTracking().Where(airline => airline.IsActive)
            .Select(airline => new { airline.Id, airline.IataCode, airline.IcaoCode }).ToArrayAsync(cancellationToken);
        var legs = new List<(FeedFlight Flight, DateOnly Date, long AirlineId)>();
        var contractedLegs = 0;
        foreach (var day in byDate)
        {
            var contracted = (await ApplicableContracts.For(context, null, call.Station.StationId, day.Key)
                .Select(row => row.AirlineId).Distinct().ToArrayAsync(cancellationToken)).ToHashSet();
            foreach (var flight in day)
            {
                // A code two registered airlines share goes to the one with a contract.
                var match = registered.Where(airline =>
                        flight.Airline!.IataCode is { } iata && string.Equals(airline.IataCode, iata, StringComparison.OrdinalIgnoreCase) ||
                        flight.Airline!.IcaoCode is { } icao && string.Equals(airline.IcaoCode, icao, StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(airline => contracted.Contains(airline.Id)).FirstOrDefault();
                if (match is null) continue;
                legs.Add((flight, day.Key, match.Id));
                if (contracted.Contains(match.Id)) contractedLegs++;
            }
        }
        if (legs.Count == 0) return (0, 0, 0);

        var references = legs.Select(leg => Reference(leg.Flight)).ToArray();
        var existing = await context.Set<ExternalFlightProposal>()
            .Where(proposal => proposal.Provider == call.Provider && references.Contains(proposal.ExternalReference))
            .ToDictionaryAsync(proposal => proposal.ExternalReference, cancellationToken);
        var linkedLegIds = existing.Values.Where(proposal => proposal.FlightLegId != null).Select(proposal => proposal.FlightLegId!.Value)
            .ToArray();
        var linkedLegs = await context.FlightLegs.Where(leg => linkedLegIds.Contains(leg.Id))
            .ToDictionaryAsync(leg => leg.Id, cancellationToken);
        var created = 0;
        var updatedLegs = 0;
        foreach (var (flight, date, airlineId) in legs)
        {
            var reference = Reference(flight);
            var counterpart = flight.Counterpart?.IataCode is { } code && airports.TryGetValue(code, out var airport) ? airport : null;
            if (!existing.TryGetValue(reference, out var proposal))
            {
                proposal = new ExternalFlightProposal
                {
                    PublicId = Guid.CreateVersion7(), Provider = call.Provider, ExternalReference = reference,
                    StationId = call.Station.StationId, AirlineId = airlineId, OperationDate = date, Direction = flight.Direction,
                    FlightNumber = Trim(flight.Number, 16)!, ScheduledAt = flight.ScheduledUtc, FirstSeenAt = call.OccurredAt,
                    Status = ExternalFlightProposalStatus.Proposed, CreatedAt = call.OccurredAt,
                };
                context.Set<ExternalFlightProposal>().Add(proposal);
                existing[reference] = proposal;
                created++;
            }
            if (counterpart is not null && counterpart.Id != 0) proposal.CounterpartAirportId = counterpart.Id;
            proposal.CounterpartIata = flight.Counterpart?.IataCode ?? proposal.CounterpartIata;
            proposal.CounterpartName = Trim(flight.Counterpart?.Name, 180) ?? proposal.CounterpartName;
            proposal.RevisedAt = flight.RevisedUtc;
            proposal.RunwayAt = flight.RunwayUtc;
            proposal.ProviderStatus = Trim(flight.Status, 32)!;
            proposal.AircraftRegistration = Trim(flight.Registration, 16) ?? proposal.AircraftRegistration;
            proposal.AircraftModel = Trim(flight.AircraftModel, 80) ?? proposal.AircraftModel;
            proposal.Terminal = Trim(flight.Terminal, 16);
            proposal.Gate = Trim(flight.Gate, 16);
            proposal.LastSeenAt = call.OccurredAt;
            proposal.UpdatedAt = call.OccurredAt;
            if (proposal.FlightLegId is { } legId && linkedLegs.TryGetValue(legId, out var leg) &&
                leg.Source == OperationalDataSource.ExternalProvider)
            {
                leg.EstimatedAt = flight.RevisedUtc;
                leg.ActualAt = flight.RunwayUtc;
                leg.SourceObservedAt = call.OccurredAt;
                leg.UpdatedAt = call.OccurredAt;
                updatedLegs++;
            }
        }
        // New counterpart airports get their key on save; link them to the proposals afterwards.
        await context.SaveChangesAsync(cancellationToken);
        foreach (var (flight, _, _) in legs)
            if (existing.TryGetValue(Reference(flight), out var proposal) && proposal.CounterpartAirportId is null &&
                flight.Counterpart?.IataCode is { } code && airports.TryGetValue(code, out var airport))
                proposal.CounterpartAirportId = airport.Id;
        return (contractedLegs, created, updatedLegs);
    }

    /// <summary>Stable key of a leg at the provider: number, direction and scheduled UTC minute.</summary>
    public static string Reference(FeedFlight flight) =>
        $"{flight.Number}|{flight.Direction}|{flight.ScheduledUtc.UtcDateTime:yyyyMMddHHmm}";

    public async Task<FlightFeedStation?> AuthorizeManualRefreshAsync(Guid actorId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission("operations.planning.create") ||
            !actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;
        return await StationsQuery(stationId).SingleOrDefaultAsync(cancellationToken);
    }

    /// <summary>Filters before projecting: EF cannot compose further over the record projection.</summary>
    private IQueryable<FlightFeedStation> StationsQuery(Guid? stationId = null) =>
        from station in context.Stations.AsNoTracking()
        join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
        where station.IsActive && (stationId == null || station.PublicId == stationId)
        orderby station.Code
        select new FlightFeedStation(station.Id, station.PublicId, station.Code, airport.IataCode, station.IanaTimeZone);

    private Task<bool> HasContractsAsync(long stationId, DateOnly date, CancellationToken cancellationToken) =>
        ApplicableContracts.For(context, null, stationId, date).AnyAsync(cancellationToken);

    private static DateOnly LocalDate(DateTimeOffset now, string timeZoneId) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, TimeZoneInfo.FindSystemTimeZoneById(timeZoneId)).DateTime);

    private static DateTimeOffset Utc(DateTime local, TimeZoneInfo zone) =>
        new(TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone), TimeSpan.Zero);

    private static bool Valid(decimal latitude, decimal longitude) =>
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;

    private static string? Trim(string? value, int length) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim() is var text && text.Length > length ? text[..length] : value.Trim();
}
