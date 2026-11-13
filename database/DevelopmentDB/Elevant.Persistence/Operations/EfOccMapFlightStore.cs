using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.MapFlights;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Integration;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// The ELEVANT flights of a station for the map, and the keys the live aircraft are matched against (ADR-0042,
/// contracts 1.3). Both come from one read (<see cref="LoadAsync"/>), so an aircraft names a flight by the same key the
/// map lists it by. Nothing is written: the demo flights' clock and the coordinates the catalogue knows are resolved at
/// the time of the read.
/// <list type="bullet">
/// <item>Legs: those of the station's turnarounds that are neither cancelled nor diverted whose best time (actual, else
/// estimated, else scheduled) is in the window, and both legs of a visit whose aircraft is on the ground (the arrival has
/// its actual time, the departure has none, the turnaround is not completed and its day is not before yesterday). Their
/// proposals are read by turnaround and matched to each leg by its key.</item>
/// <item>Proposals: the open ones of the same days of airlines OCC's review shows (<see cref="FlightFeedVisibility"/>)
/// whose best time (runway, else revised, else scheduled; a demo flight's from its clock) is in the window. They are
/// paired over every open proposal of those days, so a visit's key does not depend on where the window cuts.</item>
/// </list>
/// </summary>
internal sealed class EfOccMapFlightStore(ElevantDbContext context) : IOccMapFlightStore, IOccMapFlightMatchKeyStore
{
    /// <summary>The match keys start this long before now: every candidate of the matcher's windows is in them.</summary>
    public static TimeSpan MatchKeysBack { get; } = TimeSpan.FromHours(2);

    /// <summary>The match keys end this long after now.</summary>
    public static TimeSpan MatchKeysAhead { get; } = TimeSpan.FromHours(6);

    /// <summary>The milestones of the flight report: an operation records each one once.</summary>
    private const int MaxMilestones = 25;

    private static readonly Dictionary<string, int> MilestoneOrder =
        FlightReportMilestones.All.ToDictionary(item => item.Code, item => item.SortOrder, StringComparer.Ordinal);

    private static readonly IReadOnlyDictionary<long, (string ProviderStatus, DateTimeOffset? RunwayAt)> NoDemoClock =
        new Dictionary<long, (string ProviderStatus, DateTimeOffset? RunwayAt)>();

    private sealed record StationRow(long Id, string Code, string IanaTimeZone, long AirportId);

    private sealed record AirportRow(long Id, string IataCode, string IcaoCode, string Name, decimal? Latitude,
        decimal? Longitude);

    private sealed record AirlineRow(long Id, Guid PublicId, string Name, string? IataCode, string IcaoCode);

    private sealed record AircraftTypeRow(long Id, Guid PublicId, string IcaoCode, string Manufacturer, string Model,
        AircraftSizeCategory? SizeCategory, bool IsActive);

    private sealed record OperationRow(long Id, Guid PublicId, long TurnaroundId, GroundOperationStatus Status);

    private sealed record MilestoneRow(long OperationId, string Code, DateTimeOffset ActualAt);

    private sealed record StandRow(long TurnaroundId, Guid StandId, string Code, string? TerminalCode);

    public Task<OccMapFlightsData?> ListAsync(Guid stationId, DateTimeOffset windowFrom, DateTimeOffset windowTo,
        DateTimeOffset now, CancellationToken cancellationToken = default) =>
        LoadAsync(stationId, windowFrom, windowTo, now, withDemo: true, cancellationToken);

    /// <summary>
    /// The map's flights from <see cref="MatchKeysBack"/> before <paramref name="now"/> to <see cref="MatchKeysAhead"/> after
    /// it, with their keys, without the demo flights: their aircraft are not real. A flight happened once its actual time
    /// is known.
    /// </summary>
    public async Task<IReadOnlyList<MapFlightMatchKey>> ListMatchKeysAsync(Guid stationId, DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        var read = await LoadAsync(stationId, now - MatchKeysBack, now + MatchKeysAhead, now, withDemo: false,
            cancellationToken);
        if (read is null) return [];
        return read.Flights.Where(flight => !flight.IsDemo)
            .Select(flight => new MapFlightMatchKey(flight.FlightKey, flight.Direction, flight.FlightNumber,
                flight.Airline.IcaoCode, flight.Airline.IataCode, flight.Aircraft?.Registration,
                flight.ActualAt ?? flight.EstimatedAt ?? flight.ScheduledAt, flight.ActualAt is not null, false))
            .ToArray();
    }

    /// <summary>
    /// The one read of the map's flights. <paramref name="withDemo"/> false leaves the demo flights out before their clock
    /// is read. Null when the station is unknown or inactive.
    /// </summary>
    private async Task<OccMapFlightsData?> LoadAsync(Guid stationId, DateTimeOffset from, DateTimeOffset to,
        DateTimeOffset now, bool withDemo, CancellationToken cancellationToken)
    {
        var station = await (from item in context.Stations.AsNoTracking()
                             join airport in context.Airports.AsNoTracking() on item.AirportId equals airport.Id
                             where item.PublicId == stationId && item.IsActive
                             select new StationRow(item.Id, item.Code, item.IanaTimeZone, airport.Id))
            .SingleOrDefaultAsync(cancellationToken);
        if (station is null) return null;

        // The station's local days that can hold a leg of the window or an aircraft on the ground now: a turnaround is
        // dated by its arrival and its departure may leave the next day.
        var today = BusinessCalendar.Today(now, station.IanaTimeZone);
        var firstDate = Earliest(BusinessCalendar.Today(from, station.IanaTimeZone), today).AddDays(-1);
        var lastDate = Latest(BusinessCalendar.Today(to, station.IanaTimeZone), today).AddDays(1);

        var legs = await LegsAsync(station.Id, firstDate, lastDate, from, to, today.AddDays(-1), withDemo, cancellationToken);
        var turnaroundIds = legs.Select(item => item.Turnaround.Id).Distinct().ToArray();
        // The proposals behind the legs, by the turnaround index; each leg takes its own by its key.
        ExternalFlightProposal[] linked = turnaroundIds.Length == 0
            ? []
            : await context.Set<ExternalFlightProposal>().AsNoTracking()
                .Where(proposal => proposal.TurnaroundId != null && turnaroundIds.Contains(proposal.TurnaroundId.Value))
                .ToArrayAsync(cancellationToken);
        OperationRow[] operations = turnaroundIds.Length == 0
            ? []
            : await context.GroundOperations.AsNoTracking().Where(operation => turnaroundIds.Contains(operation.TurnaroundId))
                .Select(operation => new OperationRow(operation.Id, operation.PublicId, operation.TurnaroundId,
                    operation.CurrentStatus))
                .ToArrayAsync(cancellationToken);
        var operationIds = operations.Select(operation => operation.Id).ToArray();
        MilestoneRow[] milestones = operationIds.Length == 0
            ? []
            : await context.Set<OperationMilestone>().AsNoTracking()
                .Where(milestone => operationIds.Contains(milestone.GroundOperationId) && milestone.ActualAt != null)
                .Select(milestone => new MilestoneRow(milestone.GroundOperationId, milestone.Code, milestone.ActualAt!.Value))
                .ToArrayAsync(cancellationToken);
        // The open assignment is the flight's stand of record, also after the push-back freed the stand (owner decision 23).
        StandRow[] stands = turnaroundIds.Length == 0
            ? []
            : await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                     join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                     join terminal in context.Terminals.AsNoTracking() on stand.TerminalId equals (long?)terminal.Id
                         into terminals
                     from terminal in terminals.DefaultIfEmpty()
                     where turnaroundIds.Contains(assignment.TurnaroundId) && assignment.AssignedTo == null
                     select new StandRow(assignment.TurnaroundId, stand.PublicId, stand.Code,
                         terminal == null ? null : terminal.Code))
                .ToArrayAsync(cancellationToken);

        var open = await OpenProposalsAsync(station.Id, firstDate, lastDate, withDemo, cancellationToken);
        // ADR-0041: the worker never writes a demo pair nobody imported; its status and runway time come from the clock.
        var demoClock = withDemo ? await DemoFlightGroups.ShownAsync(context, open, now, cancellationToken) : NoDemoClock;
        var listed = open.Where(proposal => Within(
            (demoClock.TryGetValue(proposal.Id, out var shown) ? shown.RunwayAt : proposal.RunwayAt) ??
            proposal.RevisedAt ?? proposal.ScheduledAt, from, to)).ToArray();
        // A departure joins the visit of the arrival the review suggests for it, over every open proposal of those days.
        var openKeys = open.ToDictionary(proposal => proposal.Id, proposal => proposal.PublicId);
        var arrivalOfDeparture = EfOccFlightFeedStore.SuggestDepartures(open)
            .ToDictionary(pair => pair.Value, pair => openKeys[pair.Key]);

        IReadOnlyList<DemoFlightGroup> groups = [];
        if (withDemo && linked.Concat(listed).Where(row => row.Provider == DemoFlightProvider.Name).ToArray() is
                { Length: > 0 } demoRows)
            groups = await DemoFlightGroups.CompleteAsync(context, demoRows, tracked: false, cancellationToken);
        var demoFlights = groups.ToDictionary(group => group.DemoId, group => DemoBlock(group, now));
        var demoVisits = groups.ToDictionary(group => group.DemoId, group => MapFlightKeys.Proposal(group.Arrival.PublicId));

        var airportIds = legs.Select(item => item.Leg.Direction == FlightDirection.Arrival
                ? item.Leg.OriginAirportId
                : item.Leg.DestinationAirportId)
            .Concat(listed.Select(proposal => proposal.CounterpartAirportId).OfType<long>())
            .Append(station.AirportId).Distinct().ToArray();
        var airports = await context.Airports.AsNoTracking().Where(airport => airportIds.Contains(airport.Id))
            .Select(airport => new AirportRow(airport.Id, airport.IataCode, airport.IcaoCode, airport.Name, airport.Latitude,
                airport.Longitude))
            .ToDictionaryAsync(airport => airport.Id, cancellationToken);
        var airlineIds = legs.Select(item => item.Turnaround.AirlineId).Concat(listed.Select(proposal => proposal.AirlineId))
            .Distinct().ToArray();
        var airlines = airlineIds.Length == 0
            ? new Dictionary<long, AirlineRow>()
            : await context.Airlines.AsNoTracking().Where(airline => airlineIds.Contains(airline.Id))
                .Select(airline => new AirlineRow(airline.Id, airline.PublicId, airline.Name, airline.IataCode,
                    airline.IcaoCode))
                .ToDictionaryAsync(airline => airline.Id, cancellationToken);
        var typeIds = legs.Select(item => item.Turnaround.AircraftTypeId).OfType<long>().Distinct().ToArray();
        // The turnarounds' own types, and every active type a proposal's model can be matched against.
        AircraftTypeRow[] types = typeIds.Length == 0 && listed.Length == 0
            ? []
            : await context.AircraftTypes.AsNoTracking().Where(type => type.IsActive || typeIds.Contains(type.Id))
                .Select(type => new AircraftTypeRow(type.Id, type.PublicId, type.IcaoCode, type.Manufacturer, type.Model,
                    type.SizeCategory, type.IsActive))
                .ToArrayAsync(cancellationToken);
        var typesById = types.ToDictionary(type => type.Id);
        var typesByPublicId = types.ToDictionary(type => type.PublicId);
        var candidates = types.Where(type => type.IsActive)
            .Select(type => new AircraftTypeCandidate(type.PublicId, type.IcaoCode, type.Manufacturer, type.Model)).ToArray();

        var proposalsOf = linked.ToLookup(proposal => proposal.TurnaroundId!.Value);
        // A leg names the proposal OCC linked to it last: after a 3-N07 link, the feed's pair that joined it.
        var proposalOfLeg = linked.Where(proposal => proposal.FlightLegId is not null)
            .GroupBy(proposal => proposal.FlightLegId!.Value)
            .ToDictionary(group => group.Key,
                group => group.OrderByDescending(proposal => proposal.DecidedAt).ThenByDescending(proposal => proposal.Id).First());
        var operationOf = operations.ToDictionary(operation => operation.TurnaroundId);
        var milestonesOf = milestones.Where(milestone => MilestoneOrder.ContainsKey(milestone.Code))
            .GroupBy(milestone => milestone.OperationId)
            .ToDictionary(group => group.Key, group => (IReadOnlyList<OccMapMilestoneData>)group
                .OrderBy(milestone => MilestoneOrder[milestone.Code]).Take(MaxMilestones)
                .Select(milestone => new OccMapMilestoneData(milestone.Code, milestone.ActualAt)).ToArray());
        var standOf = stands.GroupBy(stand => stand.TurnaroundId).ToDictionary(group => group.Key, group => group.First());

        OccMapFlightData FromLeg(Turnaround turnaround, FlightLeg leg)
        {
            var proposals = proposalsOf[turnaround.Id];
            // A turnaround the import created keeps the keys of the proposals it came from (contracts 1.3).
            var provider = turnaround.Source == OperationalDataSource.ExternalProvider ? turnaround.ExternalProvider : null;
            var origin = provider is null || leg.ExternalReference is null
                ? null
                : proposals.FirstOrDefault(item => item.Provider == provider && item.ExternalReference == leg.ExternalReference);
            var arrival = provider is null || turnaround.ExternalReference is null
                ? null
                : proposals.FirstOrDefault(item => item.Provider == provider &&
                    item.ExternalReference == turnaround.ExternalReference);
            var proposal = proposalOfLeg.GetValueOrDefault(leg.Id);
            var direction = leg.Direction.ToString();
            var actualKind = leg.ActualAt is null
                ? null
                : leg.Source == OperationalDataSource.ExternalProvider ? MapFlightActualKinds.Runway : MapFlightActualKinds.OnBlock;
            var airline = airlines[turnaround.AirlineId];
            var operation = operationOf.GetValueOrDefault(turnaround.Id);
            var stand = standOf.GetValueOrDefault(turnaround.Id);
            var isDemo = turnaround.ExternalProvider == DemoFlightProvider.Name;
            var type = turnaround.AircraftTypeId is { } typeId ? typesById.GetValueOrDefault(typeId) : null;
            return new OccMapFlightData(
                origin is null ? MapFlightKeys.Leg(leg.PublicId) : MapFlightKeys.Proposal(origin.PublicId),
                arrival is null ? MapFlightKeys.Turnaround(turnaround.PublicId) : MapFlightKeys.Proposal(arrival.PublicId),
                proposal?.PublicId, leg.PublicId, turnaround.PublicId, direction, leg.FlightNumber,
                FlightAircraftMatcher.IcaoCallsign(airline.IcaoCode, leg.FlightNumber), Airline(airline),
                Airport(airports.GetValueOrDefault(leg.Direction == FlightDirection.Arrival
                    ? leg.OriginAirportId
                    : leg.DestinationAirportId)),
                leg.ScheduledAt, leg.EstimatedAt, leg.ActualAt, actualKind,
                MapFlightPhases.Of(direction, proposal?.ProviderStatus, leg.ScheduledAt, leg.EstimatedAt, leg.ActualAt,
                    actualKind, now),
                proposal?.ProviderStatus, LegAircraft(turnaround.AircraftRegistration, type), true,
                new OccMapTurnaroundData(turnaround.PublicId, turnaround.OperationCode, turnaround.CurrentStatus.ToString(),
                    operation?.PublicId, operation?.Status.ToString()),
                stand is null ? null : new OccMapStandData(stand.StandId, stand.Code, stand.TerminalCode), null,
                operation is not null && milestonesOf.TryGetValue(operation.Id, out var recorded) ? recorded : [],
                isDemo,
                isDemo && DemoFlightNumbering.DemoIdOf(turnaround.ExternalReference) is { } demoId
                    ? demoFlights.GetValueOrDefault(demoId)
                    : null);
        }

        OccMapFlightData FromProposal(ExternalFlightProposal proposal)
        {
            var (providerStatus, runwayAt) = demoClock.TryGetValue(proposal.Id, out var shown)
                ? shown
                : (proposal.ProviderStatus, proposal.RunwayAt);
            var actualKind = runwayAt is null ? null : MapFlightActualKinds.Runway;
            var direction = proposal.Direction.ToString();
            var airline = airlines[proposal.AirlineId];
            var isDemo = proposal.Provider == DemoFlightProvider.Name;
            var demoId = isDemo ? DemoFlightNumbering.DemoIdOf(proposal.ExternalReference) : null;
            var own = MapFlightKeys.Proposal(proposal.PublicId);
            // A demo flight's legs are one visit by its demo id; the feed's, by the review's suggestion.
            var visitKey = demoId is { } demo && demoVisits.TryGetValue(demo, out var demoVisit)
                ? demoVisit
                : proposal.Direction == FlightDirection.Departure &&
                  arrivalOfDeparture.TryGetValue(proposal.PublicId, out var arrivalId)
                    ? MapFlightKeys.Proposal(arrivalId)
                    : own;
            var suggested = AircraftModelMatcher.Suggest(proposal.AircraftModel, candidates) is { } suggestedId
                ? typesByPublicId.GetValueOrDefault(suggestedId)
                : null;
            return new OccMapFlightData(own, visitKey, proposal.PublicId, null, null, direction, proposal.FlightNumber,
                FlightAircraftMatcher.IcaoCallsign(airline.IcaoCode, proposal.FlightNumber), Airline(airline),
                ProposalCounterpart(proposal, airports), proposal.ScheduledAt, proposal.RevisedAt, runwayAt, actualKind,
                MapFlightPhases.Of(direction, providerStatus, proposal.ScheduledAt, proposal.RevisedAt, runwayAt, actualKind,
                    now),
                providerStatus, ProposalAircraft(proposal, suggested), false, null, null,
                isDemo ? Blank(proposal.Gate) : null, [], isDemo,
                demoId is { } flight ? demoFlights.GetValueOrDefault(flight) : null);
        }

        var stationAirport = airports[station.AirportId];
        var flights = legs.Select(item => FromLeg(item.Turnaround, item.Leg)).Concat(listed.Select(FromProposal))
            .OrderBy(flight => flight.ActualAt ?? flight.EstimatedAt ?? flight.ScheduledAt)
            .ThenBy(flight => flight.FlightNumber, StringComparer.Ordinal)
            .ThenBy(flight => flight.Direction, StringComparer.Ordinal)
            .ThenBy(flight => flight.FlightKey, StringComparer.Ordinal)
            .ToArray();
        return new OccMapFlightsData(stationId, station.Code, now, from, to,
            Airport(stationAirport.IataCode, stationAirport.IcaoCode, stationAirport.Name, stationAirport.Latitude,
                stationAirport.Longitude),
            flights);
    }

    /// <summary>
    /// The legs of the station's turnarounds of [<paramref name="firstDate"/>, <paramref name="lastDate"/>] that are
    /// neither cancelled nor diverted (the station, day and status index) and that the map shows: the best time of the leg
    /// is in the window, or the aircraft of the visit is on the ground.
    /// </summary>
    private async Task<IReadOnlyList<(Turnaround Turnaround, FlightLeg Leg)>> LegsAsync(long stationId, DateOnly firstDate,
        DateOnly lastDate, DateTimeOffset from, DateTimeOffset to, DateOnly yesterday, bool withDemo,
        CancellationToken cancellationToken)
    {
        var rows = await (from turnaround in context.Turnarounds.AsNoTracking()
                          join leg in context.FlightLegs.AsNoTracking() on turnaround.Id equals leg.TurnaroundId
                          where turnaround.StationId == stationId && turnaround.OperationDate >= firstDate &&
                                turnaround.OperationDate <= lastDate &&
                                turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
                                turnaround.CurrentStatus != TurnaroundStatus.Diverted
                          select new { Turnaround = turnaround, Leg = leg })
            .ToArrayAsync(cancellationToken);
        var chosen = new List<(Turnaround Turnaround, FlightLeg Leg)>();
        foreach (var visit in rows.GroupBy(row => row.Turnaround.Id))
        {
            var turnaround = visit.First().Turnaround;
            if (!withDemo && turnaround.ExternalProvider == DemoFlightProvider.Name) continue;
            var arrival = visit.FirstOrDefault(row => row.Leg.Direction == FlightDirection.Arrival)?.Leg;
            var departure = visit.FirstOrDefault(row => row.Leg.Direction == FlightDirection.Departure)?.Leg;
            // The aircraft landed and has not left: the visit stays on the map whatever its times, across midnight too.
            var onGround = arrival?.ActualAt is not null && departure?.ActualAt is null &&
                turnaround.CurrentStatus != TurnaroundStatus.Completed && turnaround.OperationDate >= yesterday;
            foreach (var row in visit.OrderBy(row => row.Leg.Direction))
                if (onGround || Within(row.Leg.ActualAt ?? row.Leg.EstimatedAt ?? row.Leg.ScheduledAt, from, to))
                    chosen.Add((turnaround, row.Leg));
        }
        return chosen;
    }

    /// <summary>
    /// The open proposals of the station's days (the station, day and status index) of airlines OCC's review shows those
    /// days; with <paramref name="withDemo"/> false, without the demo flights'.
    /// </summary>
    private async Task<ExternalFlightProposal[]> OpenProposalsAsync(long stationId, DateOnly firstDate, DateOnly lastDate,
        bool withDemo, CancellationToken cancellationToken)
    {
        var open = await context.Set<ExternalFlightProposal>().AsNoTracking()
            .Where(proposal => proposal.StationId == stationId && proposal.OperationDate >= firstDate &&
                proposal.OperationDate <= lastDate && proposal.Status == ExternalFlightProposalStatus.Proposed)
            .ToArrayAsync(cancellationToken);
        if (!withDemo) open = open.Where(proposal => proposal.Provider != DemoFlightProvider.Name).ToArray();
        if (open.Length == 0) return open;
        var shown = await FlightFeedVisibility.ShownAsync(context, stationId,
            open.Select(proposal => proposal.OperationDate).Distinct().ToArray(), cancellationToken);
        return open.Where(proposal => shown(proposal.AirlineId, proposal.OperationDate)).ToArray();
    }

    private static OccMapDemoData DemoBlock(DemoFlightGroup group, DateTimeOffset now)
    {
        var timeline = group.At(now);
        return new OccMapDemoData(group.DemoId, timeline.State.ToString(), timeline.PhaseAt(now).ToString(),
            timeline.AppearAt, timeline.TouchdownAt, timeline.OnBlockAt, timeline.ScheduledOffBlockAt, timeline.OffBlockAt,
            timeline.TakeoffAt, timeline.VanishAt);
    }

    private static OccMapAirlineData Airline(AirlineRow airline) =>
        new(airline.PublicId, airline.Name, Blank(airline.IataCode), airline.IcaoCode);

    /// <summary>An airport of <c>ref.airports</c>; null without one or without an IATA code.</summary>
    private static OccMapAirportData? Airport(AirportRow? row) =>
        row is null || string.IsNullOrWhiteSpace(row.IataCode)
            ? null
            : Airport(row.IataCode, row.IcaoCode, row.Name, row.Latitude, row.Longitude);

    /// <summary>
    /// An airport with its reference point: the one its row has, else the one the demo flights' catalogue knows, read here
    /// and never written. An empty ICAO code is none.
    /// </summary>
    private static OccMapAirportData Airport(string iata, string? icao, string name, decimal? latitude, decimal? longitude)
    {
        if (latitude is null || longitude is null)
        {
            var known = DemoAirports.Find(iata);
            (latitude, longitude) = known is { Latitude: not null, Longitude: not null }
                ? (known.Latitude, known.Longitude)
                : ((decimal?)null, (decimal?)null);
        }
        return new OccMapAirportData(iata, Blank(icao), name, latitude, longitude);
    }

    /// <summary>
    /// The other airport of a proposal: its row when the feed knew it, else what the proposal says with the catalogue's
    /// data; null without an IATA code.
    /// </summary>
    private static OccMapAirportData? ProposalCounterpart(ExternalFlightProposal proposal,
        IReadOnlyDictionary<long, AirportRow> airports)
    {
        if (proposal.CounterpartAirportId is { } airportId && airports.TryGetValue(airportId, out var row)) return Airport(row);
        var iata = FlightIdentity.NormalizeIata(proposal.CounterpartIata);
        if (iata.Length == 0) return null;
        var known = DemoAirports.Find(iata);
        return Airport(iata, known?.IcaoCode, Blank(proposal.CounterpartName) ?? known?.Name ?? iata, null, null);
    }

    /// <summary>The turnaround's registration and type («manufacturer model»); null when it knows neither.</summary>
    private static OccMapAircraftData? LegAircraft(string? registration, AircraftTypeRow? type)
    {
        registration = Blank(registration);
        return registration is null && type is null
            ? null
            : new OccMapAircraftData(registration, type?.IcaoCode,
                type is null ? null : $"{type.Manufacturer} {type.Model}".Trim(), type?.SizeCategory?.ToString());
    }

    /// <summary>
    /// The registration and the model the provider reported, with the type <see cref="AircraftModelMatcher"/> suggests for
    /// it; null when the proposal says nothing of its aircraft.
    /// </summary>
    private static OccMapAircraftData? ProposalAircraft(ExternalFlightProposal proposal, AircraftTypeRow? suggested)
    {
        var registration = Blank(proposal.AircraftRegistration);
        var model = Blank(proposal.AircraftModel);
        return registration is null && model is null && suggested is null
            ? null
            : new OccMapAircraftData(registration, suggested?.IcaoCode, model, suggested?.SizeCategory?.ToString());
    }

    private static bool Within(DateTimeOffset instant, DateTimeOffset from, DateTimeOffset to) =>
        instant >= from && instant <= to;

    private static DateOnly Earliest(DateOnly first, DateOnly second) => first < second ? first : second;

    private static DateOnly Latest(DateOnly first, DateOnly second) => first > second ? first : second;

    private static string? Blank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
