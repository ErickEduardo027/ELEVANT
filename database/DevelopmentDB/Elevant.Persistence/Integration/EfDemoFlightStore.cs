using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Common;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Audit;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Step = Elevant.Persistence.Operations.MasterDataCommand.Step;

namespace Elevant.Persistence.Integration;

/// <summary>
/// The provider statuses a demo flight carries (ADR-0041): the words the paid feed reports, so every screen reads a
/// demo leg as it reads any other.
/// </summary>
internal static class DemoProviderStatus
{
    public const string Approaching = "Approaching";
    public const string Expected = "Expected";
    public const string Arrived = "Arrived";
    public const string GateClosed = "GateClosed";
    public const string Departed = "Departed";
    public const string Canceled = "Canceled";
}

/// <summary>
/// What OCC built from a demo pair it imported: the turnaround of the arrival's leg, its operation with the hand-off
/// and the push-back the tablet recorded, and the stand the flight holds now.
/// </summary>
internal sealed record DemoFlightLink(Guid TurnaroundId, string OperationCode, TurnaroundStatus TurnaroundStatus,
    string? OperationStatus, DateTimeOffset? HandedOffAt, DateTimeOffset? PushbackAt, string? StandCode);

/// <summary>
/// A demo flight as the database holds it (ADR-0041): its two proposals and, once OCC imported them, what the
/// operation says. Nothing else is stored: the state, the phase and every instant come from
/// <see cref="DemoFlightTimeline"/> over <see cref="Facts"/>.
/// </summary>
internal sealed record DemoFlightGroup(Guid DemoId, ExternalFlightProposal Arrival, ExternalFlightProposal Departure,
    DemoFlightLink? Link)
{
    public IReadOnlyList<ExternalFlightProposal> Rows => [Arrival, Departure];

    /// <summary>OCC imported the pair and still operates it: the leg is linked and its turnaround is neither cancelled nor diverted.</summary>
    public bool Imported => Arrival.FlightLegId is not null &&
        Link is { TurnaroundStatus: not (TurnaroundStatus.Cancelled or TurnaroundStatus.Diverted) };

    /// <summary>
    /// What the rows say. A row dismissed with an account cancelled the flight at that instant (the superadministrator
    /// before touchdown, or OCC dismissing a proposal nobody imported); a provider cancellation of an imported pair keeps
    /// its rows and counts from the arrival's last change. A row dismissed without an account was closed by the worker,
    /// or by «Terminar demo» on a pair nobody imported.
    /// </summary>
    public DemoFlightFacts Facts
    {
        get
        {
            var dismissed = Rows.Where(row => row.Status == ExternalFlightProposalStatus.Dismissed).ToArray();
            var cancelledAt = dismissed.Where(row => row.DecidedByAccountId is not null).Min(row => row.DecidedAt) ??
                (Arrival.ProviderStatus == DemoProviderStatus.Canceled ? Arrival.UpdatedAt : (DateTimeOffset?)null);
            return new DemoFlightFacts(Arrival.FirstSeenAt, Arrival.ScheduledAt, Departure.ScheduledAt, Imported,
                Departure.RunwayAt, Imported ? Link!.PushbackAt : null, Imported ? Link!.HandedOffAt : null,
                Departure.RevisedAt, cancelledAt, dismissed.Any(row => row.DecidedByAccountId is null));
        }
    }

    public DemoFlightTimeline At(DateTimeOffset now) => DemoFlightTimeline.Resolve(Facts, now);
}

/// <summary>
/// Reads demo flights (ADR-0041). Both rows of a flight share the demo id their references carry; a query that
/// selected only one of them (the other is dismissed, or the list filters by status) gets its sibling by reference,
/// and a row whose sibling does not exist is left out.
/// </summary>
internal static class DemoFlightGroups
{
    /// <summary>True for the demo provider and null for any other: the mark the contracts emit only when true.</summary>
    public static bool? Mark(string? provider) => provider == DemoFlightProvider.Name ? true : null;

    public static IQueryable<ExternalFlightProposal> Rows(ElevantDbContext context) =>
        context.Set<ExternalFlightProposal>().Where(proposal => proposal.Provider == DemoFlightProvider.Name);

    /// <summary>Both rows of one demo flight, through the unique index of the provider reference.</summary>
    public static IQueryable<ExternalFlightProposal> Of(ElevantDbContext context, Guid demoId)
    {
        var arrival = DemoFlightNumbering.Reference(demoId, FlightDirection.Arrival);
        var departure = DemoFlightNumbering.Reference(demoId, FlightDirection.Departure);
        return Rows(context).Where(proposal => proposal.ExternalReference == arrival || proposal.ExternalReference == departure);
    }

    public static async Task<IReadOnlyList<DemoFlightGroup>> LoadAsync(ElevantDbContext context,
        IQueryable<ExternalFlightProposal> rows, bool tracked, CancellationToken cancellationToken) =>
        await CompleteAsync(context, await (tracked ? rows : rows.AsNoTracking()).ToArrayAsync(cancellationToken), tracked,
            cancellationToken);

    /// <summary>
    /// The flights of <paramref name="rows"/>, in the order their first row comes. Rows of other providers are ignored.
    /// </summary>
    public static async Task<IReadOnlyList<DemoFlightGroup>> CompleteAsync(ElevantDbContext context,
        IReadOnlyCollection<ExternalFlightProposal> rows, bool tracked, CancellationToken cancellationToken)
    {
        var pairs = new Dictionary<Guid, ExternalFlightProposal?[]>();
        var order = new List<Guid>();
        foreach (var row in rows)
        {
            if (row.Provider != DemoFlightProvider.Name ||
                DemoFlightNumbering.DemoIdOf(row.ExternalReference) is not { } demoId) continue;
            if (!pairs.TryGetValue(demoId, out var pair))
            {
                pairs[demoId] = pair = new ExternalFlightProposal?[2];
                order.Add(demoId);
            }
            pair[Slot(row)] ??= row;
        }
        var missing = order.Where(demoId => pairs[demoId].Any(row => row is null))
            .Select(demoId => DemoFlightNumbering.Reference(demoId,
                pairs[demoId][0] is null ? FlightDirection.Arrival : FlightDirection.Departure))
            .ToArray();
        if (missing.Length > 0)
        {
            var siblings = Rows(context).Where(proposal => missing.Contains(proposal.ExternalReference));
            foreach (var sibling in await (tracked ? siblings : siblings.AsNoTracking()).ToArrayAsync(cancellationToken))
                if (DemoFlightNumbering.DemoIdOf(sibling.ExternalReference) is { } demoId &&
                    pairs.TryGetValue(demoId, out var pair))
                    pair[Slot(sibling)] ??= sibling;
        }
        var complete = order.Where(demoId => pairs[demoId].All(row => row is not null)).ToArray();
        var links = await LinksAsync(context,
            complete.Select(demoId => pairs[demoId][0]!.TurnaroundId).OfType<long>().Distinct().ToArray(), cancellationToken);
        return complete.Select(demoId =>
        {
            var arrival = pairs[demoId][0]!;
            return new DemoFlightGroup(demoId, arrival, pairs[demoId][1]!,
                arrival.TurnaroundId is { } turnaroundId ? links.GetValueOrDefault(turnaroundId) : null);
        }).ToArray();
    }

    /// <summary>
    /// What the review shows for the demo legs nobody imported, by proposal key. The progress worker never writes them
    /// (the versions OCC read stay valid for the import), so their status and runway time come from the clock at the
    /// time of the read: the arrival lands at touchdown, the departure leaves at take-off and both read as cancelled
    /// once the flight is.
    /// </summary>
    public static async Task<IReadOnlyDictionary<long, (string ProviderStatus, DateTimeOffset? RunwayAt)>> ShownAsync(
        ElevantDbContext context, IReadOnlyCollection<ExternalFlightProposal> listed, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var shown = new Dictionary<long, (string ProviderStatus, DateTimeOffset? RunwayAt)>();
        var open = listed.Where(row => row.Provider == DemoFlightProvider.Name &&
            row.Status == ExternalFlightProposalStatus.Proposed).ToArray();
        if (open.Length == 0) return shown;
        var demoIds = open.Select(row => DemoFlightNumbering.DemoIdOf(row.ExternalReference)).ToHashSet();
        var rows = listed.Where(row => row.Provider == DemoFlightProvider.Name &&
            demoIds.Contains(DemoFlightNumbering.DemoIdOf(row.ExternalReference))).ToArray();
        foreach (var group in await CompleteAsync(context, rows, tracked: false, cancellationToken))
        {
            var timeline = group.At(now);
            foreach (var row in group.Rows.Where(row => row.Status == ExternalFlightProposalStatus.Proposed))
            {
                if (timeline.State == DemoFlightState.Cancelled)
                    shown[row.Id] = (DemoProviderStatus.Canceled, row.RunwayAt);
                else if (row.Direction == FlightDirection.Arrival && now >= timeline.TouchdownAt)
                    shown[row.Id] = (DemoProviderStatus.Arrived, timeline.TouchdownAt);
                else if (row.Direction == FlightDirection.Departure && now >= timeline.TakeoffAt)
                    shown[row.Id] = (DemoProviderStatus.Departed, timeline.TakeoffAt);
            }
        }
        return shown;
    }

    private static int Slot(ExternalFlightProposal row) => row.Direction == FlightDirection.Arrival ? 0 : 1;

    private static async Task<Dictionary<long, DemoFlightLink>> LinksAsync(ElevantDbContext context, long[] turnaroundIds,
        CancellationToken cancellationToken)
    {
        if (turnaroundIds.Length == 0) return [];
        var turnarounds = await (from turnaround in context.Turnarounds.AsNoTracking()
                                 join operation in context.GroundOperations.AsNoTracking()
                                     on turnaround.Id equals operation.TurnaroundId into operations
                                 from operation in operations.DefaultIfEmpty()
                                 where turnaroundIds.Contains(turnaround.Id)
                                 select new
                                 {
                                     turnaround.Id, turnaround.PublicId, turnaround.OperationCode, turnaround.CurrentStatus,
                                     OperationId = operation == null ? (long?)null : operation.Id,
                                     OperationStatus = operation == null ? (GroundOperationStatus?)null : operation.CurrentStatus,
                                     HandedOffAt = operation == null ? null : operation.ActualEndAt,
                                 }).ToArrayAsync(cancellationToken);
        var operationIds = turnarounds.Select(item => item.OperationId).OfType<long>().ToArray();
        var pushbacks = (await context.Set<OperationMilestone>().AsNoTracking()
                .Where(milestone => operationIds.Contains(milestone.GroundOperationId) &&
                    milestone.Code == RampEvidenceTimePolicy.Pushback && milestone.ActualAt != null)
                .Select(milestone => new { milestone.GroundOperationId, milestone.ActualAt }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.GroundOperationId, item => item.ActualAt);
        var stands = (await (from assignment in context.Set<StandAssignment>().AsNoTracking()
                             join stand in context.Stands.AsNoTracking() on assignment.StandId equals stand.Id
                             where turnaroundIds.Contains(assignment.TurnaroundId) && assignment.AssignedTo == null
                             select new { assignment.TurnaroundId, stand.Code }).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.TurnaroundId, item => item.Code);
        return turnarounds.GroupBy(item => item.Id).ToDictionary(group => group.Key, group =>
        {
            var item = group.First();
            return new DemoFlightLink(item.PublicId, item.OperationCode, item.CurrentStatus, item.OperationStatus?.ToString(),
                item.HandedOffAt, item.OperationId is { } operationId ? pushbacks[operationId].FirstOrDefault() : null,
                stands[item.Id].FirstOrDefault());
        });
    }
}

/// <summary>
/// The demo flights of the superadministrator (ADR-0041): two proposals of the provider «Demo» that OCC reviews,
/// imports and operates like any other flight. A flight is nothing but those rows; cancelling or finishing it writes
/// what a provider would report and nothing is ever deleted. The progress worker calls <see cref="AdvanceAsync"/>.
/// </summary>
internal sealed class EfDemoFlightStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider timeProvider)
    : IDemoFlightStore
{
    private const string CreateAction = "governance.demo_flight.create";
    private const string CancelAction = "governance.demo_flight.cancel";
    private const string Resource = "integration.external_flight_proposals";
    private const string StateField = "demo_flight.state";
    private const string PreferredStation = "PUJ";
    private const string NoOccAccounts = "no_occ_accounts";
    private const string CrossesLocalMidnight = "crosses_local_midnight";
    /// <summary>The length of the provider's gate and terminal fields: a longer stand code cannot be suggested.</summary>
    private const int GateLength = 16;
    private const int ModelLength = 80;
    private const int ListLimit = 50;
    private static readonly TimeSpan ListWindow = TimeSpan.FromHours(24);

    private sealed record StationRow(long Id, Guid PublicId, string Code, string Name, string IanaTimeZone, string AirportIata);

    public async Task<DemoFlightOptionsData?> OptionsAsync(Guid actorId, Guid? stationId,
        CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return null;
        var now = Now();
        var stations = await StationsAsync(cancellationToken);
        var types = (await context.AircraftTypes.AsNoTracking().Where(type => type.IsActive)
                .OrderBy(type => type.IcaoCode)
                .Select(type => new { type.PublicId, type.IcaoCode, type.Manufacturer, type.Model, type.SizeCategory })
                .ToArrayAsync(cancellationToken))
            .Select(type => new DemoAircraftTypeOptionData(type.PublicId, type.IcaoCode, type.Manufacturer, type.Model,
                type.SizeCategory?.ToString())).ToArray();
        var listed = stations.Select(item => new DemoStationOptionData(item.PublicId, item.Code, item.Name)).ToArray();
        if (Choose(stations, stationId) is not { } station)
            return new DemoFlightOptionsData(true, now, listed, null, null, [], [], types, [], DemoFlightLimitsData.For(0), [],
                null);

        var today = BusinessCalendar.Today(now, station.IanaTimeZone);
        var covered = await ApplicableContracts.For(context, null, station.Id, today).Select(row => row.AirlineId)
            .ToArrayAsync(cancellationToken);
        var single = covered.GroupBy(id => id).Where(group => group.Count() == 1).Select(group => group.Key).ToArray();
        var airlines = await context.Airlines.AsNoTracking().Where(airline => airline.IsActive && single.Contains(airline.Id))
            .OrderBy(airline => airline.Name)
            .Select(airline => new DemoAirlineOptionData(airline.PublicId, airline.Name, airline.IataCode, airline.IcaoCode))
            .ToArrayAsync(cancellationToken);

        var active = await ActiveAsync(station.Id, now, cancellationToken);
        var demoStands = DemoStands(active);
        // The form's defaults: the create checks the stand again with the window it is asked for.
        var from = now.AddMinutes(DemoFlightRules.DefaultMinutesToOnBlock);
        var occupied = (await StandAvailability.Occupying(context, station.Id, from,
                from.AddMinutes(DemoFlightRules.DefaultGroundMinutes), null)
            .Select(row => row.StandId).ToArrayAsync(cancellationToken)).ToHashSet();
        var stands = (await (from stand in context.Stands.AsNoTracking()
                             join terminal in context.Terminals.AsNoTracking() on stand.TerminalId equals (long?)terminal.Id
                             where stand.StationId == station.Id && stand.IsActive && terminal.IsActive
                             select new { stand.Id, stand.PublicId, stand.Code, Terminal = terminal.Code })
                .ToArrayAsync(cancellationToken))
            .Where(stand => stand.Code.Length <= GateLength)
            .Select(stand => new { Stand = stand, Order = NaturalOrder(stand.Code) })
            .OrderBy(item => item.Stand.Terminal, StringComparer.Ordinal)
            .ThenBy(item => item.Order.Prefix, StringComparer.Ordinal).ThenBy(item => item.Order.Number)
            .ThenBy(item => item.Order.Suffix, StringComparer.Ordinal)
            .Select(item => new DemoStandOptionData(item.Stand.PublicId, item.Stand.Code, item.Stand.Terminal, Located: false,
                Free: !occupied.Contains(item.Stand.Id) && !demoStands.Contains(StandCodes.Normalize(item.Stand.Code)),
                CoveredBy: [], EligibleAgents: 0, Eligible: false, Reasons: []))
            .ToArray();

        var warnings = new List<DemoFlightWarningData>();
        if ((await OperationalNotificationWriter.OccRecipientsAsync(context, station.Id, now, null, cancellationToken)).Length == 0)
            warnings.Add(new DemoFlightWarningData(NoOccAccounts, []));
        // The operation date is the local day of the arrival: a flight that parks after midnight is tomorrow's.
        if (BusinessCalendar.Today(now.AddMinutes(DemoFlightRules.MaxMinutesToOnBlock), station.IanaTimeZone) != today)
            warnings.Add(new DemoFlightWarningData(CrossesLocalMidnight, []));
        return new DemoFlightOptionsData(true, now, listed, station.PublicId, today, airlines,
            await AirportOptionsAsync(station.AirportIata, cancellationToken), types, stands,
            DemoFlightLimitsData.For(active.Count), warnings, null);
    }

    public async Task<DemoFlightListData?> ListAsync(Guid actorId, Guid? stationId,
        CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return null;
        var now = Now();
        if (Choose(await StationsAsync(cancellationToken), stationId) is not { } station)
            return new DemoFlightListData(true, now, null, []);
        var since = now - ListWindow;
        var arrivals = DemoFlightGroups.Rows(context)
            .Where(proposal => proposal.StationId == station.Id && proposal.Direction == FlightDirection.Arrival &&
                proposal.FirstSeenAt >= since)
            .OrderByDescending(proposal => proposal.FirstSeenAt).ThenByDescending(proposal => proposal.Id).Take(ListLimit);
        var groups = await DemoFlightGroups.LoadAsync(context, arrivals, tracked: false, cancellationToken);
        return new DemoFlightListData(true, now, station.PublicId, await DescribeAsync(groups, now, cancellationToken));
    }

    public async Task<MasterDataResult<DemoFlightData>> CreateAsync(Guid actorId, CreateDemoFlightInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        // The handler already checked the request; the rules are applied again so the store never trusts its caller.
        if (DemoFlightRules.Normalize(new CreateDemoFlightCommand(input.StationId, input.AirlineId, input.OriginIata,
                input.DestinationIata, input.AircraftTypeId, input.StandChoice.ToString(), input.StandId,
                input.MinutesToOnBlock, input.GroundMinutes)) is not { } request)
            return Failed(MasterDataFailure.Invalid, DemoFlightCodes.Invalid);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new
        {
            request.StationId, request.AirlineId, request.OriginIata, request.DestinationIata, request.AircraftTypeId,
            standChoice = request.StandChoice.ToString(), request.StandId, request.MinutesToOnBlock, request.GroundMinutes,
        });
        var now = Now();
        var demoId = Guid.CreateVersion7();

        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, CreateAction, hash, "version_conflict", now,
            async () =>
            {
                var station = (await StationsAsync(cancellationToken)).SingleOrDefault(item => item.PublicId == request.StationId);
                if (station is null) return Step.Fail(MasterDataFailure.NotFound, "station_unavailable");
                if (DemoFlightRules.UsesStationAirport(station.AirportIata, request.OriginIata, request.DestinationIata))
                    return Step.Fail(MasterDataFailure.Invalid, DemoFlightCodes.Invalid);
                var onBlockAt = now.AddMinutes(request.MinutesToOnBlock);
                var offBlockAt = onBlockAt.AddMinutes(request.GroundMinutes);
                var operationDate = BusinessCalendar.Today(onBlockAt, station.IanaTimeZone);

                var airline = await context.Airlines.AsNoTracking().Where(item => item.PublicId == request.AirlineId)
                    .Select(item => new { item.Id, item.IsActive, item.IataCode, item.IcaoCode, item.Name })
                    .SingleOrDefaultAsync(cancellationToken);
                if (airline is null || !airline.IsActive) return Step.Fail(MasterDataFailure.Conflict, "airline_inactive");
                // The import needs exactly one contract version that day: the flight is asked for only when OCC can take it.
                var contracts = await ApplicableContracts.For(context, airline.Id, station.Id, operationDate)
                    .Select(row => row.VersionId).Take(2).ToArrayAsync(cancellationToken);
                if (contracts.Length != 1)
                    return Step.Fail(MasterDataFailure.Conflict, contracts.Length == 0 ? "contract_not_in_force" : "contract_ambiguous");
                var type = await context.AircraftTypes.AsNoTracking()
                    .Where(item => item.PublicId == request.AircraftTypeId && item.IsActive)
                    .Select(item => new { item.Manufacturer, item.Model, item.SizeCategory }).SingleOrDefaultAsync(cancellationToken);
                if (type is null) return Step.Fail(MasterDataFailure.Conflict, "aircraft_type_unavailable");

                var origin = await CounterpartAsync(request.OriginIata, now, cancellationToken);
                var destination = request.DestinationIata == request.OriginIata
                    ? origin
                    : await CounterpartAsync(request.DestinationIata, now, cancellationToken);
                if (origin is null || destination is null) return Step.Fail(MasterDataFailure.Conflict, DemoFlightCodes.OriginUnknown);

                var active = await ActiveAsync(station.Id, now, cancellationToken);
                (string Code, string Terminal)? stand = null;
                if (request.StandId is { } standId)
                {
                    // Locked like every command that places a flight: two triggers for one stand wait for each other.
                    await StandAvailability.LockAsync(context, standId, cancellationToken);
                    var placement = await StandAvailability.CheckAsync(context, station.Id, standId, onBlockAt, offBlockAt,
                        type.SizeCategory, null, cancellationToken);
                    if (!placement.Available) return Step.Fail(MasterDataFailure.Conflict, "stand_unavailable", placement.Reasons);
                    var chosen = await (from item in context.Stands.AsNoTracking()
                                        join terminal in context.Terminals.AsNoTracking() on item.TerminalId equals (long?)terminal.Id
                                        where item.Id == placement.StandId
                                        select new { item.Code, Terminal = terminal.Code }).SingleAsync(cancellationToken);
                    if (chosen.Code.Length > GateLength) return Step.Fail(MasterDataFailure.Conflict, "stand_unavailable");
                    // Another demo aircraft is on its way to it, or still parked on it.
                    if (DemoStands(active).Contains(StandCodes.Normalize(chosen.Code)))
                        return Step.Fail(MasterDataFailure.Conflict, "stand_unavailable", ["stand_taken"]);
                    stand = (chosen.Code, chosen.Terminal);
                }
                if (active.Count >= DemoFlightRules.MaxActivePerStation)
                    return Step.Fail(MasterDataFailure.Conflict, DemoFlightCodes.LimitReached);

                // A number OCC already planned that day would make the import join the pair to that flight (3-N07).
                var used = (await context.Set<ExternalFlightProposal>().AsNoTracking()
                        .Where(item => item.StationId == station.Id && item.OperationDate == operationDate)
                        .Select(item => item.FlightNumber).ToArrayAsync(cancellationToken))
                    .Concat(await (from turnaround in context.Turnarounds.AsNoTracking()
                                   join leg in context.FlightLegs.AsNoTracking() on turnaround.Id equals leg.TurnaroundId
                                   where turnaround.StationId == station.Id && turnaround.OperationDate == operationDate &&
                                         turnaround.CurrentStatus != TurnaroundStatus.Cancelled
                                   select leg.FlightNumber).ToArrayAsync(cancellationToken))
                    .Select(FlightIdentity.NormalizeFlightNumber).ToHashSet(StringComparer.Ordinal);
                var numbers = DemoFlightNumbering.NextPair(DemoFlightNumbering.AirlineCode(airline.IataCode, airline.IcaoCode), used);
                var flightsOfDay = await DemoFlightGroups.Rows(context).AsNoTracking().CountAsync(item =>
                    item.StationId == station.Id && item.OperationDate == operationDate &&
                    item.Direction == FlightDirection.Arrival, cancellationToken);
                var registration = DemoFlightNumbering.Registration(flightsOfDay + 1);
                if (numbers is null || registration is null) return Step.Fail(MasterDataFailure.Conflict, DemoFlightCodes.LimitReached);

                // New counterpart airports get their key on save.
                await context.SaveChangesAsync(cancellationToken);
                var model = $"{type.Manufacturer} {type.Model}".Trim();
                if (model.Length > ModelLength) model = model[..ModelLength];
                ExternalFlightProposal Row(FlightDirection direction, Guid publicId, string number, Airport counterpart,
                    DateTimeOffset scheduledAt, DateTimeOffset? revisedAt, string providerStatus) => new()
                {
                    PublicId = publicId, Provider = DemoFlightProvider.Name,
                    ExternalReference = DemoFlightNumbering.Reference(demoId, direction), StationId = station.Id,
                    AirlineId = airline.Id, OperationDate = operationDate, Direction = direction, FlightNumber = number,
                    CounterpartAirportId = counterpart.Id, CounterpartIata = counterpart.IataCode,
                    CounterpartName = counterpart.Name, ScheduledAt = scheduledAt, RevisedAt = revisedAt,
                    ProviderStatus = providerStatus, AircraftRegistration = registration, AircraftModel = model,
                    Terminal = stand?.Terminal, Gate = stand?.Code, FirstSeenAt = now, LastSeenAt = now,
                    Status = ExternalFlightProposalStatus.Proposed, CreatedAt = now, UpdatedAt = now,
                };
                // The arrival carries the demo id as its own: the flight is found by either.
                context.Set<ExternalFlightProposal>().AddRange(
                    Row(FlightDirection.Arrival, demoId, numbers.Value.Arrival, origin, onBlockAt, onBlockAt,
                        DemoProviderStatus.Approaching),
                    Row(FlightDirection.Departure, Guid.CreateVersion7(), numbers.Value.Departure, destination, offBlockAt, null,
                        DemoProviderStatus.Expected));
                MasterDataCommand.Audit(context, accountId, "governance.demo_flight.created", Resource, demoId, station.Id, now,
                    new("demo_flight.arrival", null, numbers.Value.Arrival),
                    new("demo_flight.departure", null, numbers.Value.Departure),
                    new("demo_flight.airline", null, airline.Name),
                    new("demo_flight.origin", null, origin.IataCode),
                    new("demo_flight.destination", null, destination.IataCode),
                    new("demo_flight.registration", null, registration),
                    new("demo_flight.minutes_to_on_block", null, request.MinutesToOnBlock.ToString(CultureInfo.InvariantCulture)),
                    new("demo_flight.ground_minutes", null, request.GroundMinutes.ToString(CultureInfo.InvariantCulture)),
                    new("demo_flight.stand", null, stand?.Code),
                    new(StateField, null, nameof(DemoFlightState.Active)));
                // OCC's screens read the review again and see the flight coming.
                await OccPlanningChangeWriter.AddForStationAsync(context, station.Id, station.PublicId, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(demoId);
            }, id => ReadAsync(id, cancellationToken), cancellationToken);
    }

    public async Task<MasterDataResult<DemoFlightData>> CancelAsync(Guid actorId, Guid demoFlightId, DemoFlightIntent intent,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return Failed(MasterDataFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty) return Failed(MasterDataFailure.Invalid, "idempotency_key_required");
        if (demoFlightId == Guid.Empty || !Enum.IsDefined(intent)) return Failed(MasterDataFailure.Invalid, DemoFlightCodes.Invalid);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { demoFlightId, intent = intent.ToString() });
        var now = Now();

        // No expected version: the worker's stamps make the row versions stale by design, so the intent is checked
        // against the phase the flight is in instead.
        return await MasterDataCommand.RunAsync(context, idempotencyKey, accountId, CancelAction, hash, "version_conflict", now,
            async () =>
            {
                var group = (await DemoFlightGroups.LoadAsync(context, DemoFlightGroups.Of(context, demoFlightId), tracked: true,
                    cancellationToken)).SingleOrDefault();
                if (group is null) return Step.Fail(MasterDataFailure.NotFound, "not_found");
                var timeline = group.At(now);
                // Cancelled or finished, or its departure is already decided (a push-back, a hand-off, an earlier
                // «Terminar demo» or the end of the wait of an imported aircraft): there is nothing left to end.
                if (timeline.State != DemoFlightState.Active || DepartureDecided(group, timeline))
                    return Step.Fail(MasterDataFailure.Conflict, DemoFlightCodes.Closed);
                // «Cancelar vuelo» is offered before the wheels touch the runway, «Terminar demo» after: a screen that
                // sends the other one read the flight in an earlier phase.
                var landed = now >= timeline.TouchdownAt;
                if (intent == DemoFlightIntent.Cancel ? landed : !landed)
                    return Step.Fail(MasterDataFailure.Conflict, "version_conflict");
                var station = await context.Stations.AsNoTracking().Where(item => item.Id == group.Arrival.StationId)
                    .Select(item => item.PublicId).SingleAsync(cancellationToken);
                var confirmed = group.Rows.Any(row => row.Status == ExternalFlightProposalStatus.Confirmed);

                string state;
                if (intent == DemoFlightIntent.Cancel)
                {
                    // What a provider cancellation is: nobody had imported it and the pair leaves the review, or OCC had
                    // and gets the notice of a flight its provider cancelled. The turnaround is OCC's to decide.
                    foreach (var row in group.Rows)
                    {
                        Report(row, DemoProviderStatus.Canceled, now);
                        if (row.Status == ExternalFlightProposalStatus.Proposed) Dismiss(row, now, accountId);
                    }
                    if (confirmed && group.Arrival.TurnaroundId is { } turnaroundId &&
                        EfFlightFeedSyncStore.ProviderAlertKind(DemoProviderStatus.Canceled) is { } kind)
                        await ProviderFlightAlerts.AlertOccAsync(context, turnaroundId, kind, now, cancellationToken);
                    state = nameof(DemoFlightState.Cancelled);
                }
                else
                {
                    // The off-block comes forward, never before the aircraft parks, whether OCC imported the flight or
                    // not, and the clock has the take-off a taxi later. No runway time is written here: only the worker
                    // writes one, the take-off the clock planned, so the departure never comes before the arrival.
                    var revisedAt = now < timeline.OnBlockAt ? timeline.OnBlockAt : now;
                    group.Departure.RevisedAt = revisedAt;
                    Report(group.Departure, DemoProviderStatus.GateClosed, now);
                    if (confirmed)
                    {
                        if (await ProviderLegAsync(group.Departure.FlightLegId, cancellationToken) is { } leg)
                        {
                            leg.EstimatedAt = revisedAt;
                            leg.SourceObservedAt = now;
                            leg.UpdatedAt = now;
                        }
                        state = "Finishing";
                    }
                    else
                    {
                        // Nobody imported it: the pair leaves the review at once and the worker never writes it again.
                        // No account on the rows, so the flight reads as finished and not cancelled; the audit entry says
                        // who ended it.
                        foreach (var row in group.Rows.Where(row => row.Status == ExternalFlightProposalStatus.Proposed))
                            Dismiss(row, now, null);
                        state = nameof(DemoFlightState.Finished);
                    }
                }
                MasterDataCommand.Audit(context, accountId,
                    intent == DemoFlightIntent.Cancel ? "governance.demo_flight.cancelled" : "governance.demo_flight.finished",
                    Resource, group.DemoId, group.Arrival.StationId, now,
                    new AuditFieldChangeData(StateField, nameof(DemoFlightState.Active), state));
                await OccPlanningChangeWriter.AddForStationAsync(context, group.Arrival.StationId, station, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                return Step.Done(group.DemoId);
            }, id => ReadAsync(id, cancellationToken), cancellationToken);
    }

    /// <summary>
    /// One tick of the progress worker. Each flight that reached something is read again, written and saved on its own,
    /// so a pair OCC imported or dismissed in the same moment (a stale row version) only skips this tick.
    /// </summary>
    public async Task<int> AdvanceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        now = Truncate(now);
        context.ChangeTracker.Clear();
        var since = EarliestOpenDate(now);
        var candidates = await DemoFlightGroups.LoadAsync(context,
            DemoFlightGroups.Rows(context).Where(proposal => proposal.OperationDate >= since &&
                proposal.Status != ExternalFlightProposalStatus.Dismissed), tracked: false, cancellationToken);
        var changed = 0;
        var announced = new HashSet<long>();
        foreach (var candidate in candidates)
        {
            if (!Reached(candidate, now).Any) continue;
            try
            {
                context.ChangeTracker.Clear();
                var group = (await DemoFlightGroups.LoadAsync(context, DemoFlightGroups.Of(context, candidate.DemoId),
                    tracked: true, cancellationToken)).SingleOrDefault();
                if (group is null || !await WriteAsync(group, now, cancellationToken)) continue;
                var stationId = group.Arrival.StationId;
                if (!announced.Contains(stationId))
                {
                    var station = await context.Stations.AsNoTracking().Where(item => item.Id == stationId)
                        .Select(item => item.PublicId).SingleAsync(cancellationToken);
                    await OccPlanningChangeWriter.AddForStationAsync(context, stationId, station, now, cancellationToken);
                }
                await context.SaveChangesAsync(cancellationToken);
                announced.Add(stationId);
                changed++;
            }
            catch (DbUpdateConcurrencyException)
            {
                // OCC decided on the pair meanwhile: the next tick reads it as it is then.
                context.ChangeTracker.Clear();
            }
        }
        context.ChangeTracker.Clear();
        return changed;
    }

    /// <summary>
    /// The departure no longer depends on the superadministrator: the tablet recorded the push-back, the agent handed the
    /// operation off, «Terminar demo» already brought the off-block forward, or the imported aircraft waited as long as
    /// it may. A flight nobody imported leaves on schedule, which is not a decision.
    /// </summary>
    private static bool DepartureDecided(DemoFlightGroup group, DemoFlightTimeline timeline)
    {
        var facts = group.Facts;
        return (facts.PushbackAt ?? facts.HandedOffAt ?? facts.FinishRequestedAt) is not null ||
            (group.Imported && timeline.OffBlockAt is not null);
    }

    /// <summary>What the clock reached that the rows do not say yet.</summary>
    private sealed record Progress(bool Vanished, DateTimeOffset? LandedAt, DateTimeOffset? TookOffAt)
    {
        public bool Any => Vanished || LandedAt is not null || TookOffAt is not null;
    }

    /// <summary>
    /// A pair nobody imported is only ever dismissed, when it vanishes (for a cancelled flight, at once): until then
    /// the review derives its status from the clock and its versions stay as OCC read them. An imported flight gets
    /// what the paid feed would report: the landing at touchdown and the departure at take-off.
    /// </summary>
    private static Progress Reached(DemoFlightGroup group, DateTimeOffset now)
    {
        var timeline = group.At(now);
        if (group.Imported)
            return timeline.State == DemoFlightState.Cancelled
                ? new Progress(false, null, null)
                : new Progress(false,
                    group.Arrival.RunwayAt is null && now >= timeline.TouchdownAt ? timeline.TouchdownAt : null,
                    group.Departure.RunwayAt is null && timeline.TakeoffAt is { } takeoffAt && now >= takeoffAt ? takeoffAt : null);
        return new Progress(now >= timeline.VanishAt &&
            group.Rows.Any(row => row.Status == ExternalFlightProposalStatus.Proposed), null, null);
    }

    private async Task<bool> WriteAsync(DemoFlightGroup group, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var reached = Reached(group, now);
        if (!reached.Any) return false;
        if (reached.Vanished)
        {
            var cancelled = group.At(now).State == DemoFlightState.Cancelled;
            foreach (var row in group.Rows.Where(row => row.Status == ExternalFlightProposalStatus.Proposed))
                Dismiss(row, now, null);
            context.AuditEntries.Add(new AuditEntry
            {
                PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.System, ActorDisplay = "Sistema",
                Action = "governance.demo_flight.expired", EntityType = Resource, EntityPublicId = group.DemoId,
                StationId = group.Arrival.StationId, Source = AuditSource.BackgroundJob, CorrelationId = Guid.CreateVersion7(),
                MetadataJson = SafeAuditChanges.Serialize(new AuditFieldChangeData(StateField, nameof(DemoFlightState.Active),
                    cancelled ? nameof(DemoFlightState.Cancelled) : nameof(DemoFlightState.Finished))),
            });
            return true;
        }
        if (reached.LandedAt is { } landedAt)
            await StampAsync(group.Arrival, DemoProviderStatus.Arrived, landedAt, now, cancellationToken);
        if (reached.TookOffAt is { } tookOffAt)
            await StampAsync(group.Departure, DemoProviderStatus.Departed, tookOffAt, now, cancellationToken);
        return true;
    }

    /// <summary>
    /// The runway time on the proposal and, like the feed's ingest, on its leg while the leg is still the provider's: a
    /// time OCC recorded by hand is never rewritten. The instant is the one the clock planned, not the tick's.
    /// </summary>
    private async Task StampAsync(ExternalFlightProposal row, string providerStatus, DateTimeOffset runwayAt,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        row.RunwayAt = runwayAt;
        Report(row, providerStatus, now);
        if (await ProviderLegAsync(row.FlightLegId, cancellationToken) is not { } leg) return;
        leg.ActualAt = runwayAt;
        leg.SourceObservedAt = now;
        leg.UpdatedAt = now;
    }

    private async Task<FlightLeg?> ProviderLegAsync(long? legId, CancellationToken cancellationToken) =>
        legId is { } id && await context.FlightLegs.SingleOrDefaultAsync(leg => leg.Id == id, cancellationToken) is
            { Source: OperationalDataSource.ExternalProvider } leg
            ? leg
            : null;

    private static void Report(ExternalFlightProposal row, string providerStatus, DateTimeOffset now)
    {
        row.ProviderStatus = providerStatus;
        row.LastSeenAt = now;
        row.UpdatedAt = now;
    }

    private static void Dismiss(ExternalFlightProposal row, DateTimeOffset now, long? accountId)
    {
        row.Status = ExternalFlightProposalStatus.Dismissed;
        row.DecidedAt = now;
        row.DecidedByAccountId = accountId;
        row.UpdatedAt = now;
    }

    /// <summary>
    /// The oldest operation date a demo flight still in progress can have. The date is the station's local day of the
    /// arrival and a flight ends within hours of it (the ground time, the wait for the agent and the departure), so
    /// whatever the station's zone it is never before the day before the UTC date.
    /// </summary>
    private static DateOnly EarliestOpenDate(DateTimeOffset now) => DateOnly.FromDateTime(now.UtcDateTime).AddDays(-1);

    /// <summary>
    /// The demo flights that count toward the station's limit. A flight with a dismissed row is cancelled or finished.
    /// </summary>
    private async Task<IReadOnlyList<DemoFlightGroup>> ActiveAsync(long stationId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var since = EarliestOpenDate(now);
        var groups = await DemoFlightGroups.LoadAsync(context,
            DemoFlightGroups.Rows(context).Where(proposal => proposal.StationId == stationId &&
                proposal.OperationDate >= since && proposal.Status != ExternalFlightProposalStatus.Dismissed),
            tracked: false, cancellationToken);
        return groups.Where(group => group.At(now).State == DemoFlightState.Active).ToArray();
    }

    /// <summary>
    /// The stands the active demo aircraft are heading to or parked on, as <see cref="StandCodes"/> compares them: the
    /// stand the trigger suggested while nobody imported the flight, and afterwards the one OCC gave it. A demo
    /// aircraft waits for its agent past its planned window, when the stand's own availability no longer counts it.
    /// </summary>
    private static HashSet<string> DemoStands(IEnumerable<DemoFlightGroup> active) =>
        active.Select(group => group.Imported ? group.Link!.StandCode : group.Arrival.Gate).OfType<string>()
            .Select(StandCodes.Normalize).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// The counterpart airport of a leg: the row the database already has, taking the time zone and the coordinates it
    /// lacks from the catalogue as the feed's harvest does, or the catalogue's row. Null when neither knows the code,
    /// or another airport already holds the catalogue's ICAO code. The caller saves.
    /// </summary>
    private async Task<Airport?> CounterpartAsync(string iata, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var known = DemoAirports.Find(iata);
        var row = await context.Airports.SingleOrDefaultAsync(airport => airport.IataCode == iata, cancellationToken);
        if (row is not null)
        {
            if (known is null) return row;
            if (row.IanaTimeZone is null && known.TimeZone is { } zone) (row.IanaTimeZone, row.UpdatedAt) = (zone, now);
            if (row.Latitude is null && Coordinates(known) is { } point)
                (row.Latitude, row.Longitude, row.UpdatedAt) = (point.Latitude, point.Longitude, now);
            return row;
        }
        if (known is not { IcaoCode: { } icao, CountryCode: { } country } ||
            await context.Airports.AsNoTracking().AnyAsync(airport => airport.IcaoCode == icao, cancellationToken))
            return null;
        row = new Airport
        {
            PublicId = Guid.CreateVersion7(), IataCode = iata, IcaoCode = icao, Name = known.Name,
            City = known.City ?? known.Name, CountryCode = country, IanaTimeZone = known.TimeZone,
            Latitude = Coordinates(known)?.Latitude, Longitude = Coordinates(known)?.Longitude, CreatedAt = now, UpdatedAt = now,
        };
        context.Airports.Add(row);
        return row;
    }

    private static (decimal Latitude, decimal Longitude)? Coordinates(FeedAirport airport) =>
        airport.Latitude is { } latitude && airport.Longitude is { } longitude &&
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180
            ? (Math.Round(latitude, 6), Math.Round(longitude, 6))
            : null;

    /// <summary>
    /// The airports the form offers: those the database has with coordinates or can complete from the catalogue, and
    /// the catalogue's own that a create would insert. Never the station's airport.
    /// </summary>
    private async Task<DemoAirportOptionData[]> AirportOptionsAsync(string stationIata, CancellationToken cancellationToken)
    {
        var catalogue = DemoAirports.All.Where(airport => airport is { IataCode: not null, IcaoCode: not null, CountryCode: not null })
            .ToArray();
        var iatas = catalogue.Select(airport => airport.IataCode!).ToArray();
        var icaos = catalogue.Select(airport => airport.IcaoCode!).ToArray();
        var rows = await context.Airports.AsNoTracking()
            .Where(airport => iatas.Contains(airport.IataCode) || icaos.Contains(airport.IcaoCode) ||
                (airport.Latitude != null && airport.Longitude != null))
            .Select(airport => new
            {
                airport.IataCode, airport.IcaoCode, airport.Name, airport.City, airport.CountryCode,
                Located = airport.Latitude != null && airport.Longitude != null,
            }).ToArrayAsync(cancellationToken);
        var offered = rows.Where(row => row.Located || iatas.Contains(row.IataCode))
            .Select(row => new DemoAirportOptionData(row.IataCode, row.IcaoCode, row.Name, row.City, row.CountryCode));
        var inserted = catalogue.Where(airport => rows.All(row => row.IataCode != airport.IataCode && row.IcaoCode != airport.IcaoCode))
            .Select(airport => new DemoAirportOptionData(airport.IataCode!, airport.IcaoCode!, airport.Name,
                airport.City ?? airport.Name, airport.CountryCode!));
        return offered.Concat(inserted).Where(airport => airport.IataCode != FlightIdentity.NormalizeIata(stationIata))
            .OrderBy(airport => airport.IataCode, StringComparer.Ordinal).ToArray();
    }

    private async Task<DemoFlightData?> ReadAsync(Guid demoId, CancellationToken cancellationToken)
    {
        var groups = await DemoFlightGroups.LoadAsync(context, DemoFlightGroups.Of(context, demoId), tracked: false,
            cancellationToken);
        return (await DescribeAsync(groups, Now(), cancellationToken)).SingleOrDefault();
    }

    private async Task<DemoFlightData[]> DescribeAsync(IReadOnlyList<DemoFlightGroup> groups, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (groups.Count == 0) return [];
        var stationIds = groups.Select(group => group.Arrival.StationId).Distinct().ToArray();
        var airlineIds = groups.Select(group => group.Arrival.AirlineId).Distinct().ToArray();
        var stations = await context.Stations.AsNoTracking().Where(item => stationIds.Contains(item.Id))
            .Select(item => new { item.Id, item.PublicId, item.Code }).ToDictionaryAsync(item => item.Id, cancellationToken);
        var airlines = await context.Airlines.AsNoTracking().Where(item => airlineIds.Contains(item.Id))
            .Select(item => new { item.Id, item.PublicId, item.Name }).ToDictionaryAsync(item => item.Id, cancellationToken);
        return groups.Select(group =>
        {
            var station = stations[group.Arrival.StationId];
            var airline = airlines[group.Arrival.AirlineId];
            var timeline = group.At(now);
            var link = group.Imported ? group.Link : null;
            return new DemoFlightData(group.DemoId, station.PublicId, station.Code, airline.PublicId, airline.Name,
                group.Arrival.FlightNumber, group.Departure.FlightNumber, group.Arrival.AircraftRegistration ?? string.Empty,
                group.Arrival.AircraftModel ?? string.Empty, group.Arrival.CounterpartIata ?? string.Empty,
                group.Departure.CounterpartIata ?? string.Empty, group.Arrival.Gate, timeline.State.ToString(),
                timeline.PhaseAt(now).ToString(), timeline.AppearAt, timeline.TouchdownAt, timeline.OnBlockAt,
                timeline.ScheduledOffBlockAt, timeline.OffBlockAt, timeline.TakeoffAt, timeline.VanishAt, link is not null,
                link?.TurnaroundId, link?.OperationCode, link?.StandCode, link?.OperationStatus);
        }).ToArray();
    }

    /// <summary>The active stations with the airport each one operates at, by code.</summary>
    private async Task<StationRow[]> StationsAsync(CancellationToken cancellationToken) =>
        await (from station in context.Stations.AsNoTracking()
               join airport in context.Airports.AsNoTracking() on station.AirportId equals airport.Id
               where station.IsActive
               orderby station.Code
               select new StationRow(station.Id, station.PublicId, station.Code, station.Name, station.IanaTimeZone,
                   airport.IataCode)).ToArrayAsync(cancellationToken);

    /// <summary>The station asked for; without one (or when it is no longer active) Punta Cana, else the first by code.</summary>
    private static StationRow? Choose(StationRow[] stations, Guid? stationId) =>
        stations.FirstOrDefault(station => station.PublicId == stationId) ??
        stations.FirstOrDefault(station => station.Code == PreferredStation) ??
        stations.FirstOrDefault();

    /// <summary>«A2» before «A10»: letters, then the number, then what follows it.</summary>
    private static (string Prefix, int Number, string Suffix) NaturalOrder(string code)
    {
        var text = StandCodes.Normalize(code);
        var start = 0;
        while (start < text.Length && !char.IsAsciiDigit(text[start])) start++;
        var end = start;
        while (end < text.Length && char.IsAsciiDigit(text[end])) end++;
        return (text[..start],
            int.TryParse(text.AsSpan(start, end - start), NumberStyles.None, CultureInfo.InvariantCulture, out var number)
                ? number
                : int.MaxValue,
            text[end..]);
    }

    private async Task<bool> IsSuperAdministratorAsync(Guid actorId, CancellationToken cancellationToken) =>
        actorId != Guid.Empty &&
        (await actors.ResolveAsync(actorId, cancellationToken))?.EffectiveAccess?.IsSuperAdministrator == true;

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    private DateTimeOffset Now() => Truncate(timeProvider.GetUtcNow());

    /// <summary>Instants are stored with milliseconds: what is written is what is read back.</summary>
    private static DateTimeOffset Truncate(DateTimeOffset value) =>
        new(value.UtcTicks - value.UtcTicks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);

    private static MasterDataResult<DemoFlightData> Failed(MasterDataFailure failure, string code) =>
        MasterDataResult<DemoFlightData>.Failed(failure, code);
}
