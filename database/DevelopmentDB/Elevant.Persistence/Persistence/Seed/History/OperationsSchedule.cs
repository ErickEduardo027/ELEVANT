using System.Globalization;
using Elevant.Domain.Enumerations;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>How an operation of the history ends.</summary>
internal enum OperationOutcome
{
    Approved,
    Cancelled,

    /// <summary>Revision 1 returned with a reason, corrected and revision 2 approved.</summary>
    ReturnedThenApproved,

    /// <summary>Handed off, OCC has not decided yet (the last days only).</summary>
    PendingReview,

    /// <summary>Returned by OCC and not corrected yet (two operations of the last days).</summary>
    ReturnedOpen,
}

internal sealed record PlannedService(HistoryRate Rate, int Line, ServiceExecutionStatus Status, decimal Executed,
    DateTimeOffset? StartedAt, DateTimeOffset EndedAt, string? Note, bool BySupport);

internal sealed record PlannedIncident(int Index, string Type, IncidentSeverity Severity, string Description,
    string? DelayCode, DateTimeOffset OccurredAt, DateTimeOffset ReportedAt);

/// <summary>
/// One operation decided in memory before any row is written: who flies, when, where, who works it, what is executed
/// and how OCC closes it. Every instant falls inside the station's operating day (05:30–22:30).
/// </summary>
internal sealed class PlannedOperation
{
    public required DateOnly Date { get; init; }
    public required int Slot { get; init; }
    public required HistoryAirline Airline { get; init; }
    public required HistoryContractVersion Version { get; init; }
    public required long OriginAirportId { get; init; }
    public required string ArrivalFlight { get; init; }
    public required string DepartureFlight { get; init; }
    public required OperationsReference.Aircraft Aircraft { get; init; }
    public required string Registration { get; init; }
    public required int PassengersIn { get; init; }
    public required int PassengersOut { get; init; }
    public required int MtowKg { get; init; }
    public required StandAnchor Stand { get; init; }
    public required bool UsesBridgeChecklist { get; init; }
    public required DateTimeOffset PlannedAt { get; init; }
    public required DateTimeOffset ScheduledArrival { get; init; }
    public required DateTimeOffset ScheduledDeparture { get; init; }
    public required OperationOutcome Outcome { get; set; }
    public DateTimeOffset? CancelledAt { get; init; }
    public string? CancelReason { get; init; }
    public DateTimeOffset AssignedAt { get; init; }
    public DateTimeOffset ActualStart { get; init; }
    public DateTimeOffset BlockOn { get; init; }
    public DateTimeOffset Pushback { get; init; }
    public DateTimeOffset Submitted { get; init; }
    public DateTimeOffset? Decided { get; set; }
    public DateTimeOffset? CorrectionOpened { get; set; }
    public DateTimeOffset? Resubmitted { get; set; }
    public DateTimeOffset? FinalDecided { get; set; }
    public string? ReturnReason { get; init; }
    public IReadOnlyList<(HistoryAgent Agent, string Role)> Agents { get; init; } = [];
    public IReadOnlyList<PlannedService> Services { get; init; } = [];
    public IReadOnlyList<PlannedIncident> Incidents { get; init; } = [];

    /// <summary>Deterministic key prefix of every row of this operation.</summary>
    public string Key => string.Create(CultureInfo.InvariantCulture, $"ops:{Date:yyyy-MM-dd}:{Slot:00}");

    public bool IsCancelled => Outcome == OperationOutcome.Cancelled;

    /// <summary>When the approval (the last decision) was recorded, for approved outcomes.</summary>
    public DateTimeOffset? ApprovedAt => Outcome switch
    {
        OperationOutcome.Approved => Decided,
        OperationOutcome.ReturnedThenApproved => FinalDecided,
        _ => null,
    };

    /// <summary>The last hand-off: the resubmission of a corrected operation, otherwise the first one.</summary>
    public DateTimeOffset LastSubmitted => Resubmitted ?? Submitted;

    public HistoryAgent Primary => Agents[0].Agent;
}

/// <summary>
/// Plans the operations of a day at PUJ: volume, airlines on their weekly pattern, a greedy stand scheduler over the
/// active stands (size and bridge respected, arrivals shifted when no stand or crew is free), 2–3 eligible agents per
/// operation (inside their shift, at most two simultaneous operations), services, delays, incidents and the review.
/// Every draw comes from streams named after the day and slot, so a day always plans the same.
/// </summary>
internal sealed class OperationsSchedule(HistoryChunkContext chunk, OperationsReference.Loaded reference)
{
    private const int FirstArrival = 6 * 60 + 30;
    private const int LastArrival = 20 * 60 + 30;
    private const int LatestDeparture = 21 * 60 + 45;
    private const int LatestPushback = 21 * 60 + 40;
    private const int LatestHandOff = 22 * 60;
    private const int MaxSimultaneous = 2;
    private const string PassengerBridge = "PASSENGER-BRIDGE";

    private sealed record AirlineProfile(string[] Origins, string[] Aircraft, string Registration);

    private static readonly Dictionary<string, AirlineProfile> Profiles = new(StringComparer.Ordinal)
    {
        ["AA"] = new(["MIA", "CLT", "PHL", "JFK"], ["B738", "A321"], "US:AA"),
        ["DL"] = new(["ATL", "JFK", "MSP"], ["B738", "A321"], "US:DN"),
        ["B6"] = new(["JFK", "BOS", "EWR"], ["A320", "A321"], "US:JB"),
        ["UA"] = new(["EWR", "ORD", "IAD"], ["B738", "B38M"], "US:UA"),
        ["AC"] = new(["YYZ", "YUL"], ["A320", "B38M"], "C-F"),
        ["TS"] = new(["YUL", "YYZ"], ["A321", "A332"], "C-G"),
        ["WG"] = new(["YYZ", "YUL"], ["B738", "B38M"], "C-F"),
        ["WS"] = new(["YYZ"], ["B738", "B38M"], "C-G"),
        ["UX"] = new(["MAD"], ["B789", "A332"], "EC-"),
        ["AF"] = new(["CDG"], ["A333", "B789"], "F-H"),
        ["DE"] = new(["FRA"], ["B763", "A333"], "D-A"),
        ["WK"] = new(["ZRH"], ["A333", "A332"], "HB-J"),
        ["ZZ"] = new(["MIA"], ["A320"], "HI"),
    };

    private static readonly AirlineProfile DefaultProfile = new(["PTY", "BOG", "MIA"], ["A320", "B738"], "HP-");

    private static readonly string[] CancelReasons =
    [
        "La aerolínea canceló el vuelo por razones operacionales.",
        "Vuelo cancelado por la aerolínea: aeronave fuera de servicio en el origen.",
        "La aerolínea consolidó el vuelo con otra frecuencia del día.",
        "Cancelado por condiciones meteorológicas en el aeropuerto de origen.",
    ];

    private static readonly string[] ReturnReasons =
    [
        "Falta registrar la cantidad ejecutada de un servicio; corrige y reenvía.",
        "El checklist indica un punto sin nota de respaldo; completa la observación.",
        "La hora de push-back no coincide con el reporte de la torre; verifica los tiempos.",
        "Un servicio quedó en excepción sin explicar qué se ejecutó; amplía la nota.",
        "Falta reportar la incidencia de equipo mencionada en la nota de entrega.",
    ];

    private static readonly string[] NotPerformedNotes =
    [
        "No requerido por la aerolínea en esta escala.",
        "La tripulación declinó el servicio.",
        "Sustituido por el equipo propio de la aerolínea.",
    ];

    private static readonly string[] ExceptionNotes =
    [
        "Ejecutado parcialmente: el equipo se averió durante el servicio.",
        "Servicio iniciado tarde por la llegada demorada; se completó lo posible.",
        "Ejecutado con equipo de respaldo y personal reducido.",
    ];

    private static readonly (string Code, double Weight)[] DelayCodes =
    [
        ("93", 8), ("11", 1), ("15", 1), ("18", 1.5), ("32", 1.5), ("33", 1), ("34", 1), ("39", 1), ("71", 1),
        ("81", 1.5), ("87", 1),
    ];

    private static readonly (string Type, IncidentSeverity Severity, string Description)[] OtherIncidents =
    [
        ("Equipment", IncidentSeverity.Medium, "La GPU presentó fallas intermitentes y se reemplazó por la unidad de respaldo."),
        ("Equipment", IncidentSeverity.Low, "La escalera móvil requirió ajuste del freno antes de posicionarse."),
        ("Equipment", IncidentSeverity.Medium, "La banda transportadora se detuvo durante la descarga; se continuó manualmente."),
        ("Safety", IncidentSeverity.High, "Se detectó FOD en la posición antes de la llegada; se retiró y se notificó a la torre."),
        ("Safety", IncidentSeverity.Medium, "Vehículo de servicio ingresó al área restringida sin escolta; se detuvo la operación."),
        ("Operational", IncidentSeverity.Low, "Equipaje sin etiqueta en la bodega; se entregó a la aerolínea para identificarlo."),
        ("Operational", IncidentSeverity.Low, "La documentación de carga llegó tarde a la posición."),
    ];

    private readonly HistoryClock _clock = chunk.Clock;
    private readonly DateTimeOffset _windowEnd = chunk.Clock.ToUtc(chunk.Options.WindowEnd, HistoryClock.DayEnd);

    /// <summary>The operations of <paramref name="date"/>, in scheduled-arrival order.</summary>
    public IReadOnlyList<PlannedOperation> PlanDay(DateOnly date)
    {
        var options = chunk.Options;
        var catalog = chunk.Catalog;
        var day = Stream(date, "day");

        // Volume: weekend +15 %, July–August +10 %, September–October −15 %, a small jitter.
        var factor = 1.0;
        if (date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) factor *= 1.15;
        if (date.Month is 7 or 8) factor *= 1.10;
        if (date.Month is 9 or 10) factor *= 0.85;
        var jitter = Math.Max(1, options.OperationsPerDay / 10);
        var count = Math.Max(1, (int)Math.Round(options.OperationsPerDay * factor) + day.Between(-jitter, jitter));

        var flying = catalog.HistoryAirlines
            .Select(airline => (Airline: airline, Version: catalog.GoverningVersion(airline.Id, date)))
            .Where(item => item.Version is { Rates.Count: > 0 })
            .ToArray();
        var today = flying.Where(item => Pattern(item.Airline).Days.Contains(date.DayOfWeek)).ToArray();
        if (today.Length == 0) today = flying;

        var candidates = new List<(HistoryAirline Airline, HistoryContractVersion Version)>();
        if (today.Length > 0)
        {
            var weights = today.Select(item => (double)Pattern(item.Airline).Weight).ToArray();
            for (var slot = 0; slot < count; slot++)
            {
                var pick = today[day.Weighted(weights)];
                candidates.Add((pick.Airline, pick.Version!));
            }
        }
        // Demo Airlines (ZZ): about one operation a day while its contract prices something, for the airline portal.
        if (catalog.Demo is { } demo && catalog.GoverningVersion(demo.Id, date) is { } demoVersion &&
            demoVersion.Rates.Any(rate => rate.UnitPrice > 0))
            candidates.Add((demo, demoVersion));

        var drafts = candidates.Select((item, slot) => Draft(date, slot, item.Airline, item.Version,
                candidates.Take(slot).Count(other => other.Airline.Id == item.Airline.Id)))
            .OrderBy(item => item.BaseArrival).ThenBy(item => item.Slot).ToArray();

        var stands = new Dictionary<long, List<(int From, int To)>>();
        var agentBusy = new Dictionary<long, List<(DateTimeOffset From, DateTimeOffset To)>>();
        var agentLoad = new Dictionary<long, int>();
        var planned = new List<PlannedOperation>();
        foreach (var draft in drafts)
        {
            var operation = Schedule(draft, stands, agentBusy, agentLoad);
            if (operation is not null) planned.Add(operation);
        }

        // Two operations of the last days stay returned without correction.
        if (date == options.WindowEnd.AddDays(-1) || date == options.WindowEnd.AddDays(-2))
        {
            var open = planned.FirstOrDefault(item => item.Outcome == OperationOutcome.Approved);
            if (open is not null) open.Outcome = OperationOutcome.ReturnedOpen;
        }
        foreach (var operation in planned) CapToWindow(operation);
        return planned.OrderBy(item => item.ScheduledArrival).ThenBy(item => item.Slot).ToArray();
    }

    private sealed record DraftOperation(DateOnly Date, int Slot, HistoryAirline Airline, HistoryContractVersion Version,
        int BaseArrival, int GroundPlanned, int Delay, int GroundActual, int Preparation, int HandOffDelay,
        long OriginAirportId, string ArrivalFlight, string DepartureFlight, OperationsReference.Aircraft Aircraft,
        string Registration, int PassengersIn, int PassengersOut, int MtowKg, bool WantsBridge, HistoryRate[] Rates,
        double[] ServiceDraws, OperationOutcome Outcome, int PlannedMinute, int AssignLead, int[] DecisionDelays,
        int CancelLead, string CancelReason, string ReturnReason, string? DelayCode, bool ExtraIncident,
        int ExtraIncidentIndex, double ThirdAgent, double[] OffsetsDraw);

    private DraftOperation Draft(DateOnly date, int slot, HistoryAirline airline, HistoryContractVersion version,
        int occurrence)
    {
        var random = Stream(date, slot.ToString("00", CultureInfo.InvariantCulture));
        var profile = Profile(airline);
        var origins = profile.Origins.Where(reference.AirportsByIata.ContainsKey).ToArray();
        var originCode = origins.Length == 0 ? chunk.Anchors.Mia.IataCode : random.Pick(origins);
        var originIndex = Array.IndexOf(profile.Origins, originCode);
        var routeNumber = RouteBase(airline) + 20 * Math.Max(0, originIndex) + 200 * occurrence;

        var aircraft = AircraftFor(profile, random);
        var wide = aircraft.Size == AircraftSizeCategory.Widebody;
        var groundPlanned = wide ? random.Between(90, 140) : random.Between(50, 75);
        var delayClass = random.Weighted([70, 20, 10]);
        var delay = delayClass switch
        {
            0 => random.Between(-10, 10),
            1 => random.Between(15, 45),
            _ => random.Between(60, 150),
        };
        var groundActual = Math.Max(40, groundPlanned + random.Between(-6, 10) - (delayClass == 0 ? 0 : random.Between(0, 10)));
        var latestBase = Math.Min(LastArrival, LatestDeparture - groundPlanned);
        var baseArrival = RoundTo(random.Between(FirstArrival, Math.Max(FirstArrival, latestBase)), 5);

        var fleet = Fleet(airline, profile);
        var registration = fleet[random.Next(fleet.Length)];
        var seats = wide ? random.Between(250, 310) : random.Between(150, 190);
        var passengersIn = (int)Math.Round(seats * random.Decimal(0.72m, 0.98m));
        var passengersOut = (int)Math.Round(seats * random.Decimal(0.70m, 0.97m));
        var mtow = wide ? random.Between(186_000, 242_000) : random.Between(64_000, 79_000);

        var recent = date > chunk.Options.WindowEnd.AddDays(-7);
        var draw = random.NextDouble();
        var outcome = recent
            ? draw < 0.02 ? OperationOutcome.Cancelled
                : draw < 0.03 ? OperationOutcome.ReturnedThenApproved
                // 5 % pending plus the 2 % «in review»: the app never writes InReview, so those wait as pending too.
                : draw < 0.10 ? OperationOutcome.PendingReview
                : OperationOutcome.Approved
            : draw < 0.02 ? OperationOutcome.Cancelled
                : draw < 0.04 ? OperationOutcome.ReturnedThenApproved
                : OperationOutcome.Approved;

        var rates = random.Shuffle(version.Rates.Where(rate => !string.IsNullOrEmpty(rate.ServiceCode)));
        var serviceDraws = Enumerable.Range(0, 12).Select(_ => random.NextDouble()).ToArray();
        var wantsBridge = version.Rate(PassengerBridge) is not null && random.Chance(0.85);
        var decisionDelays = new[]
        {
            DecisionDelay(random), random.Between(30, 180), random.Between(10, 45), DecisionDelay(random),
        };
        var codes = DelayCodes.Select(item => item.Weight).ToArray();
        var delayCode = delayClass == 0 ? null : DelayCodes[random.Weighted(codes)].Code;
        var extra = random.Chance(0.03);
        var extraIndex = random.Next(OtherIncidents.Length);
        return new DraftOperation(date, slot, airline, version, baseArrival, groundPlanned, delay, groundActual,
            random.Between(5, 15), random.Between(5, 20), reference.AirportsByIata.GetValueOrDefault(originCode, chunk.Anchors.Mia.Id),
            Flight(airline, routeNumber), Flight(airline, routeNumber + 1), aircraft, registration, passengersIn,
            passengersOut, mtow, wantsBridge, rates, serviceDraws, outcome, random.Between(9 * 60, 17 * 60),
            random.Between(30, 180), decisionDelays, random.Between(60, 240), random.Pick(CancelReasons),
            random.Pick(ReturnReasons), delayCode, extra, extraIndex, random.NextDouble(),
            Enumerable.Range(0, 4).Select(_ => random.NextDouble()).ToArray());
    }

    private PlannedOperation? Schedule(DraftOperation draft, Dictionary<long, List<(int From, int To)>> stands,
        Dictionary<long, List<(DateTimeOffset From, DateTimeOffset To)>> agentBusy, Dictionary<long, int> agentLoad)
    {
        var date = draft.Date;
        // Offsets tried in order: as planned, then 15-minute steps either side up to three hours.
        var offsets = new List<int> { 0 };
        for (var step = 15; step <= 180; step += 15) offsets.AddRange([step, -step]);
        foreach (var offset in offsets)
        {
            var arrival = draft.BaseArrival + offset;
            if (arrival < FirstArrival || arrival > LastArrival) continue;
            var departure = arrival + draft.GroundPlanned;
            var blockOn = arrival + draft.Delay;
            var pushback = blockOn + draft.GroundActual;
            var start = blockOn - draft.Preparation;
            var handOff = pushback + draft.HandOffDelay;
            if (departure > LatestDeparture || pushback > LatestPushback || handOff > LatestHandOff || start < 6 * 60)
                continue;
            var standFrom = Math.Min(arrival, start) - 10;
            var standTo = Math.Max(departure, pushback) + 10;

            var stand = PickStand(draft, stands, draft.Outcome == OperationOutcome.Cancelled ? null : (standFrom, standTo));
            if (stand is null) continue;
            var startAt = At(date, start);
            var handOffAt = At(date, handOff);

            IReadOnlyList<(HistoryAgent, string)> crew = [];
            if (draft.Outcome != OperationOutcome.Cancelled)
            {
                crew = PickCrew(draft, stand, startAt, handOffAt, agentBusy, agentLoad);
                if (crew.Count < 2) continue;
                if (!stands.TryGetValue(stand.Id, out var busy)) stands[stand.Id] = busy = [];
                busy.Add((standFrom, standTo));
                foreach (var (agent, _) in crew)
                {
                    if (!agentBusy.TryGetValue(agent.RampAgentId, out var list)) agentBusy[agent.RampAgentId] = list = [];
                    list.Add((startAt, handOffAt));
                    agentLoad[agent.RampAgentId] = agentLoad.GetValueOrDefault(agent.RampAgentId) + 1;
                }
            }
            return Build(draft, stand, arrival, departure, blockOn, pushback, start, handOff, crew);
        }
        return null;
    }

    private PlannedOperation Build(DraftOperation draft, StandAnchor stand, int arrival, int departure, int blockOn,
        int pushback, int start, int handOff, IReadOnlyList<(HistoryAgent Agent, string Role)> crew)
    {
        var date = draft.Date;
        var plannedAt = At(date.AddDays(-1), draft.PlannedMinute);
        var scheduledArrival = At(date, arrival);
        var scheduledDeparture = At(date, departure);
        var usesBridge = draft.WantsBridge && stand.HasBoardingBridge && chunk.Anchors.BridgeChecklist is not null;
        if (draft.Outcome == OperationOutcome.Cancelled)
        {
            var cancelMinute = Math.Max(HistoryClock.DayStart.Hour * 60 + HistoryClock.DayStart.Minute + 5,
                arrival - draft.CancelLead);
            return new PlannedOperation
            {
                Date = date, Slot = draft.Slot, Airline = draft.Airline, Version = draft.Version,
                OriginAirportId = draft.OriginAirportId, ArrivalFlight = draft.ArrivalFlight,
                DepartureFlight = draft.DepartureFlight, Aircraft = draft.Aircraft, Registration = draft.Registration,
                PassengersIn = draft.PassengersIn, PassengersOut = draft.PassengersOut, MtowKg = draft.MtowKg,
                Stand = stand, UsesBridgeChecklist = usesBridge, PlannedAt = plannedAt,
                ScheduledArrival = scheduledArrival, ScheduledDeparture = scheduledDeparture,
                Outcome = OperationOutcome.Cancelled, CancelledAt = At(date, Math.Min(cancelMinute, arrival)),
                CancelReason = draft.CancelReason,
            };
        }

        var startAt = At(date, start);
        var blockOnAt = At(date, blockOn);
        var pushbackAt = At(date, pushback);
        var handOffAt = At(date, handOff);
        var assignedMinute = Math.Max(HistoryClock.DayStart.Hour * 60 + HistoryClock.DayStart.Minute, start - draft.AssignLead);
        var assignedAt = At(date, Math.Min(assignedMinute, start - 5));

        // Services: 2–5 of the governing version's rates (the bridge only at a stand that has one).
        var available = draft.Rates.Where(rate => rate.ServiceCode != PassengerBridge).ToList();
        var bridgeRate = draft.Version.Rate(PassengerBridge);
        var wanted = Math.Min(available.Count + (usesBridge && bridgeRate is not null ? 1 : 0),
            2 + (int)(draft.ServiceDraws[0] * 4));
        var chosen = new List<HistoryRate>();
        if (usesBridge && bridgeRate is not null) chosen.Add(bridgeRate);
        chosen.AddRange(available.Take(Math.Max(0, wanted - chosen.Count)));
        if (chosen.Count == 0 && bridgeRate is not null) chosen.Add(bridgeRate);
        var ordered = chosen.OrderBy(rate => rate.Id).ToArray();
        var services = new List<PlannedService>();
        var window = Math.Max(20, pushback - blockOn);
        for (var index = 0; index < ordered.Length; index++)
        {
            var rate = ordered[index];
            var draw = draft.ServiceDraws[1 + index % 11];
            var status = draw < 0.90 ? ServiceExecutionStatus.Completed
                : draw < 0.94 ? ServiceExecutionStatus.Exception : ServiceExecutionStatus.NotPerformed;
            if (index == ordered.Length - 1 && status == ServiceExecutionStatus.NotPerformed &&
                services.All(item => item.Status == ServiceExecutionStatus.NotPerformed))
                status = ServiceExecutionStatus.Completed;
            var offset = (int)(draw * 1000) % Math.Max(1, window / 3);
            var begin = blockOn + offset;
            var length = Math.Max(10, (int)(window * (0.45 + 0.4 * ((draw * 7919) % 1))));
            var end = Math.Min(pushback, begin + length);
            var note = status switch
            {
                ServiceExecutionStatus.NotPerformed => NotPerformedNotes[(int)(draw * 1000) % NotPerformedNotes.Length],
                ServiceExecutionStatus.Exception => ExceptionNotes[(int)(draw * 1000) % ExceptionNotes.Length],
                _ => null,
            };
            services.Add(new PlannedService(rate, index + 1, status,
                status == ServiceExecutionStatus.NotPerformed ? 0m : Quantity(rate, pushback - blockOn, draft),
                status == ServiceExecutionStatus.NotPerformed ? null : At(date, begin),
                status == ServiceExecutionStatus.NotPerformed ? At(date, Math.Max(blockOn, pushback - 5)) : At(date, end),
                note, crew.Count > 1 && index % 2 == 1));
        }

        var incidents = new List<PlannedIncident>();
        if (draft.DelayCode is { } code)
        {
            var label = Elevant.Application.Operations.IataDelayCodes.All.Single(item => item.Code == code).Label;
            var severity = draft.Delay >= 90 ? IncidentSeverity.High
                : draft.Delay >= 45 ? IncidentSeverity.Medium : IncidentSeverity.Low;
            incidents.Add(new PlannedIncident(0, Elevant.Application.Operations.RampIncidentPolicy.Deviation, severity,
                string.Create(CultureInfo.InvariantCulture, $"Llegada con {draft.Delay} min de demora. Código IATA {code}: {label}."),
                code, blockOnAt, At(date, Math.Min(pushback, blockOn + 5 + draft.Slot % 10))));
        }
        if (draft.ExtraIncident)
        {
            var (type, severity, description) = OtherIncidents[draft.ExtraIncidentIndex];
            var occurred = blockOn + Math.Max(1, (pushback - blockOn) / 3);
            incidents.Add(new PlannedIncident(incidents.Count, type, severity, description, null, At(date, occurred),
                At(date, Math.Min(pushback, occurred + 4))));
        }

        var operation = new PlannedOperation
        {
            Date = date, Slot = draft.Slot, Airline = draft.Airline, Version = draft.Version,
            OriginAirportId = draft.OriginAirportId, ArrivalFlight = draft.ArrivalFlight,
            DepartureFlight = draft.DepartureFlight, Aircraft = draft.Aircraft, Registration = draft.Registration,
            PassengersIn = draft.PassengersIn, PassengersOut = draft.PassengersOut, MtowKg = draft.MtowKg,
            Stand = stand, UsesBridgeChecklist = usesBridge, PlannedAt = plannedAt,
            ScheduledArrival = scheduledArrival, ScheduledDeparture = scheduledDeparture, Outcome = draft.Outcome,
            AssignedAt = assignedAt, ActualStart = startAt, BlockOn = blockOnAt, Pushback = pushbackAt,
            Submitted = handOffAt, ReturnReason = draft.ReturnReason, Agents = crew, Services = services,
            Incidents = incidents,
        };
        operation.Decided = Later(handOffAt, draft.DecisionDelays[0], draft.OffsetsDraw[0]);
        operation.CorrectionOpened = Later(operation.Decided.Value, draft.DecisionDelays[1], draft.OffsetsDraw[1]);
        operation.Resubmitted = Later(operation.CorrectionOpened.Value, draft.DecisionDelays[2], draft.OffsetsDraw[2]);
        operation.FinalDecided = Later(operation.Resubmitted.Value, draft.DecisionDelays[3], draft.OffsetsDraw[3]);
        return operation;
    }

    /// <summary>Nothing happens after the end of the window: a decision that would come later is not taken yet.</summary>
    private void CapToWindow(PlannedOperation operation)
    {
        if (operation.Outcome == OperationOutcome.ReturnedThenApproved && operation.FinalDecided > _windowEnd)
            operation.Outcome = OperationOutcome.Approved;
        if (operation.Outcome is OperationOutcome.Approved or OperationOutcome.ReturnedOpen && operation.Decided > _windowEnd)
            operation.Outcome = OperationOutcome.PendingReview;
        if (operation.Outcome is not OperationOutcome.ReturnedThenApproved)
        {
            operation.CorrectionOpened = null;
            operation.Resubmitted = null;
            operation.FinalDecided = null;
        }
        if (operation.Outcome is OperationOutcome.PendingReview or OperationOutcome.Cancelled) operation.Decided = null;
    }

    private StandAnchor? PickStand(DraftOperation draft, Dictionary<long, List<(int From, int To)>> busy,
        (int From, int To)? window)
    {
        var wide = draft.Aircraft.Size == AircraftSizeCategory.Widebody;
        var candidates = chunk.Anchors.Stands
            .Where(stand => !(wide && stand.MaxAircraftSize == AircraftSizeCategory.Narrowbody))
            .OrderBy(stand => stand.HasBoardingBridge == draft.WantsBridge ? 0 : 1)
            .ThenBy(stand => StandRank(stand, draft.Slot))
            .ThenBy(stand => stand.Code, StringComparer.Ordinal);
        foreach (var stand in candidates)
        {
            if (window is not { } span) return stand;
            if (!busy.TryGetValue(stand.Id, out var taken) || taken.All(item => item.To <= span.From || span.To <= item.From))
                return stand;
        }
        return null;
    }

    /// <summary>Spreads operations over the stands of the same kind (a stable rotation by slot).</summary>
    private int StandRank(StandAnchor stand, int slot)
    {
        var index = 0;
        for (var i = 0; i < chunk.Anchors.Stands.Count; i++)
            if (chunk.Anchors.Stands[i].Id == stand.Id) index = i;
        return (index + chunk.Anchors.Stands.Count - slot % Math.Max(1, chunk.Anchors.Stands.Count)) %
            Math.Max(1, chunk.Anchors.Stands.Count);
    }

    private (HistoryAgent, string)[] PickCrew(DraftOperation draft, StandAnchor stand,
        DateTimeOffset from, DateTimeOffset to, Dictionary<long, List<(DateTimeOffset From, DateTimeOffset To)>> busy,
        Dictionary<long, int> load)
    {
        (HistoryAgent Agent, string Role)[] Free(IReadOnlyList<HistoryAgent> candidates) => candidates
            .Where(agent => agent.RampAgentId != chunk.Anchors.BaseRampAgentId)
            .Where(agent => !busy.TryGetValue(agent.RampAgentId, out var spans) ||
                spans.Count(span => span.From < to && from < span.To) < MaxSimultaneous)
            .Select(agent => (agent, string.Empty)).ToArray();
        // Agents scoped to the stand's terminal first; when too few, any eligible agent of the station.
        var eligible = Free(chunk.Catalog.EligibleAt(draft.Date, from, to, stand.TerminalId)).Select(item => item.Agent)
            .ToArray();
        if (eligible.Length < 2)
            eligible = Free(chunk.Catalog.EligibleAt(draft.Date, from, to)).Select(item => item.Agent).ToArray();
        if (eligible.Length < 2) return [];
        var covering = chunk.Catalog.CoveringAgents(stand.Id, from, to).Select(agent => agent.RampAgentId).ToHashSet();
        var tieBreak = Stream(draft.Date, $"{draft.Slot:00}:crew");
        var ranked = eligible.Select(agent => (Agent: agent, Tie: tieBreak.NextDouble()))
            .OrderBy(item => covering.Contains(item.Agent.RampAgentId) ? 0 : 1)
            .ThenBy(item => load.GetValueOrDefault(item.Agent.RampAgentId))
            .ThenBy(item => item.Tie)
            .Select(item => item.Agent).ToArray();
        var size = ranked.Length >= 3 && draft.ThirdAgent < 0.4 ? 3 : 2;
        return ranked.Take(size).Select((agent, index) => (agent, index == 0 ? "primary" : "support")).ToArray();
    }

    private static decimal Quantity(HistoryRate rate, int groundMinutes, DraftOperation draft) => rate.BillingUnit switch
    {
        "hour" => Math.Max(rate.MinimumQuantity, Math.Round(groundMinutes / 60m, 2, MidpointRounding.AwayFromZero)),
        "minute" => Math.Max(rate.MinimumQuantity, groundMinutes),
        "passenger" => Math.Max(rate.MinimumQuantity, draft.PassengersIn + draft.PassengersOut),
        "ton" => Math.Max(rate.MinimumQuantity, Math.Round(draft.MtowKg / 1000m, 3, MidpointRounding.AwayFromZero)),
        _ => Math.Max(1m, rate.MinimumQuantity),
    };

    /// <summary>OCC reviews within 20 minutes and 20 hours of the hand-off; most within the first three hours.</summary>
    private static int DecisionDelay(HistoryRandom random) => random.Weighted([60, 30, 10]) switch
    {
        0 => random.Between(20, 180),
        1 => random.Between(180, 600),
        _ => random.Between(600, 1200),
    };

    /// <summary>
    /// <paramref name="minutes"/> after <paramref name="instant"/>; an instant that falls outside the operating day
    /// moves to the next morning (05:30 plus up to two hours), never earlier than the original instant.
    /// </summary>
    private DateTimeOffset Later(DateTimeOffset instant, int minutes, double draw)
    {
        var candidate = instant.AddMinutes(minutes);
        if (_clock.IsOperatingTime(candidate)) return HistoryClock.Truncate(candidate);
        var local = _clock.LocalTime(candidate);
        var date = _clock.LocalDate(candidate);
        if (local > HistoryClock.DayEnd) date = date.AddDays(1);
        var morning = _clock.At(date, HistoryClock.DayStart).AddMinutes(5 + (int)(draw * 120));
        return morning > instant ? morning : HistoryClock.Truncate(instant.AddMinutes(1));
    }

    private DateTimeOffset At(DateOnly date, int minutes) => _clock.At(date, minutes);

    private static HistoryRandom Stream(DateOnly date, string suffix) =>
        HistoryRandom.For(string.Create(CultureInfo.InvariantCulture, $"ops:{date:yyyy-MM-dd}:{suffix}"));

    private static int RoundTo(int value, int step) => value - value % step;

    private static AirlineProfile Profile(HistoryAirline airline) =>
        airline.IataCode is { } iata && Profiles.TryGetValue(iata, out var profile) ? profile : DefaultProfile;

    private OperationsReference.Aircraft AircraftFor(AirlineProfile profile, HistoryRandom random)
    {
        var preferred = profile.Aircraft
            .Select(code => reference.Aircraft.FirstOrDefault(item => item.IcaoCode == code))
            .OfType<OperationsReference.Aircraft>().ToArray();
        if (preferred.Length > 0) return random.Pick(preferred);
        var narrow = reference.Aircraft.Where(item => item.Size == AircraftSizeCategory.Narrowbody).ToArray();
        return random.Pick(narrow.Length > 0 ? narrow : reference.Aircraft.ToArray());
    }

    private static string Flight(HistoryAirline airline, int number) =>
        string.Create(CultureInfo.InvariantCulture, $"{airline.Designator}{number}");

    private static int RouteBase(HistoryAirline airline)
    {
        var random = HistoryRandom.For($"ops:route:{airline.Designator}");
        return airline.IsHistory ? 2 * random.Between(150, 1400) : 2 * random.Between(350, 399);
    }

    private sealed record WeeklyPattern(IReadOnlySet<DayOfWeek> Days, int Weight);

    private static WeeklyPattern Pattern(HistoryAirline airline)
    {
        var random = HistoryRandom.For($"ops:pattern:{airline.Designator}");
        var days = random.Shuffle(Enum.GetValues<DayOfWeek>()).Take(random.Between(4, 7)).ToHashSet();
        return new WeeklyPattern(days, random.Between(1, 3));
    }

    private static string[] Fleet(HistoryAirline airline, AirlineProfile profile)
    {
        var random = HistoryRandom.For($"ops:fleet:{airline.Designator}");
        const string letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
        string Letters(int count) => new(Enumerable.Range(0, count).Select(_ => letters[random.Next(letters.Length)]).ToArray());
        return Enumerable.Range(0, 6).Select(_ => profile.Registration switch
        {
            var us when us.StartsWith("US:", StringComparison.Ordinal) =>
                string.Create(CultureInfo.InvariantCulture, $"N{random.Between(100, 999)}{us[3..]}"),
            "HI" or "HP-" => string.Create(CultureInfo.InvariantCulture, $"{profile.Registration}{random.Between(1000, 9999)}"),
            "HB-J" => profile.Registration + Letters(2),
            _ => profile.Registration + Letters(3),
        }).Distinct(StringComparer.Ordinal).ToArray();
    }
}
