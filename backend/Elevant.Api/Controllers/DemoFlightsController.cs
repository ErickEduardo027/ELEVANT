using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations.DemoStation;
using Elevant.Contracts.Integration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Elevant.Api.Controllers;

/// <summary>
/// The demo flights of the superadministrator (ADR-0041): a pair of flight proposals of the provider «Demo» that OCC
/// sees coming, imports and operates like any other flight, and «Cargar posiciones de Punta Cana», which gives the
/// station the stands the aircraft can be sent to. The endpoints exist in every environment; where
/// <c>DemoFlights:Mode</c> is off every command answers <c>demo_flights_unavailable</c> and the reads answer
/// <c>enabled: false</c>. Every failure carries a stable code and a Spanish title.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/governance")]
public sealed class DemoFlightsController(DemoFlightHandler handler, DemoStationHandler stations) : ControllerBase
{
    /// <summary>The Spanish titles of the refusals of one command, by cause.</summary>
    private sealed record Titles(string Forbidden, string NotFound, string Invalid, string Conflict);

    private static readonly Titles FlightTitles = new("Solo el superadministrador dispara vuelos demo.",
        "La estación o el vuelo demo ya no existe.", "Los datos del vuelo demo no son válidos.",
        "El vuelo demo no se puede crear o cambió. Vuelva a cargar los datos.");

    private static readonly Titles StationTitles = new("Solo el superadministrador carga las posiciones de Punta Cana.",
        "La estación ya no existe o no está activa.", "Los datos de la carga de posiciones no son válidos.",
        "Las posiciones de Punta Cana cambiaron. Vuelva a cargar los datos.");

    /// <summary>The conflicts whose cause has a title of its own, whichever command met it.</summary>
    private static readonly Dictionary<string, string> ConflictTitles = new(StringComparer.Ordinal)
    {
        [DemoFlightCodes.Unavailable] = "Los vuelos demo no están disponibles en este entorno.",
        [DemoFlightCodes.StationUnsupported] = "Solo Punta Cana (PUJ) tiene un plano de referencia.",
        [DemoFlightCodes.NoEligibleStand] = "Ninguna posición tiene un agente elegible a esa hora.",
        [DemoFlightCodes.StandNotEligible] = "La posición no tiene un agente elegible a esa hora.",
    };

    /// <summary>
    /// What the form «Disparar vuelo demo» offers at a station (the requested one, else Punta Cana, else the first):
    /// airlines with exactly one applicable contract today, airports, aircraft types, the stands evaluated for the visit
    /// of the form (<c>minutesToOnBlock</c> 2 to 30, 8 by default; <c>groundMinutes</c> 20 to 240, 60 by default; the
    /// size of <c>aircraftTypeId</c>, any size without it), limits, warnings and the station against the Punta Cana
    /// catalogue. A visit outside the form's ranges answers <c>invalid_demo_flight</c>.
    /// </summary>
    [HttpGet("demo-flights/options", Name = "GetDemoFlightOptions")]
    [ProducesResponseType<DemoFlightOptionsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Options([FromQuery] Guid? stationId, [FromQuery] Guid? aircraftTypeId,
        [FromQuery] int? minutesToOnBlock, [FromQuery] int? groundMinutes, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        // A visit outside the form's ranges, or an empty identifier, is refused like a malformed query: before the handler.
        if (DemoFlightRules.OptionsQuery(stationId, aircraftTypeId, minutesToOnBlock, groundMinutes) is not { } query)
            return MasterDataHttp.Coded(this, 400, FlightTitles.Invalid, DemoFlightCodes.Invalid);
        var options = await handler.OptionsAsync(actorId, query, cancellationToken);
        return options is null ? MasterDataHttp.Coded(this, 403, FlightTitles.Forbidden, "forbidden") : Ok(Map(options));
    }

    /// <summary>The demo flights of the last 24 hours at a station, newest first (at most 50), with the server time.</summary>
    [HttpGet("demo-flights", Name = "ListDemoFlights")]
    [ProducesResponseType<DemoFlightListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] Guid? stationId, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        var list = await handler.ListAsync(actorId, stationId, cancellationToken);
        return list is null
            ? MasterDataHttp.Coded(this, 403, FlightTitles.Forbidden, "forbidden")
            : Ok(new DemoFlightListResponse(list.Enabled, list.ServerTime, list.StationId, list.Flights.Select(Map).ToArray()));
    }

    /// <summary>
    /// «Disparar vuelo demo»: 201 with the new flight, 200 when the Idempotency-Key replays it. The flight numbers and the
    /// registration are generated. <c>Random</c> draws one of the eligible stands (none: <c>no_eligible_stand</c>);
    /// <c>Specific</c> needs an eligible stand (<c>stand_not_eligible</c>), and a taken or inactive one answers
    /// <c>stand_unavailable</c>. A refused stand names its rules in <c>reasons</c>.
    /// </summary>
    [HttpPost("demo-flights", Name = "CreateDemoFlight")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<DemoFlightResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<DemoFlightResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Create([FromBody, BindRequired] CreateDemoFlightRequest request,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        var result = await handler.CreateAsync(actorId, new CreateDemoFlightCommand(request.StationId, request.AirlineId,
            request.OriginIata, request.DestinationIata, request.AircraftTypeId, request.StandChoice, request.StandId,
            request.MinutesToOnBlock, request.GroundMinutes), idempotencyKey, cancellationToken);
        return result.Value is { } flight && result.Failure is null
            ? new ObjectResult(Map(flight)) { StatusCode = result.Replayed ? 200 : 201 }
            : Refused(result, FlightTitles);
    }

    /// <summary>
    /// «Cancelar vuelo» (intent <c>Cancel</c>, before touchdown) or «Terminar demo» (intent <c>Finish</c>, after it). The
    /// intent is checked against the phase instead of a version: an intent of an earlier phase answers
    /// <c>version_conflict</c>, a flight already ended <c>demo_flight_closed</c>. Nothing is deleted.
    /// </summary>
    [HttpPost("demo-flights/{demoFlightId:guid}/cancel", Name = "CancelDemoFlight")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<DemoFlightResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Cancel(Guid demoFlightId, [FromBody, BindRequired] CancelDemoFlightRequest request,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        var result = await handler.CancelAsync(actorId, demoFlightId, request.Intent, idempotencyKey, cancellationToken);
        return result.Value is { } flight && result.Failure is null ? Ok(Map(flight)) : Refused(result, FlightTitles);
    }

    /// <summary>
    /// «Cargar posiciones de Punta Cana»: creates the catalogue's terminals and stands the station lacks, active and without
    /// coordinates (the map draws them by their code), and never changes, deactivates or deletes what the station has. It
    /// answers the station as it is afterwards with 200, the first time and when the Idempotency-Key replays it: the
    /// answer is a state, not a new resource. Only Punta Cana has a catalogue (<c>demo_station_unsupported</c>).
    /// </summary>
    [HttpPost("demo-station", Name = "PrepareDemoStation")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<DemoStationLayoutResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> PrepareStation([FromBody, BindRequired] PrepareDemoStationRequest request,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        var result = await stations.PrepareAsync(actorId, request.StationId, idempotencyKey, cancellationToken);
        return result.Value is { } layout && result.Failure is null ? Ok(Map(layout)) : Refused(result, StationTitles);
    }

    /// <summary>
    /// The Problem Details of a refused command: the store's code with a Spanish title, the cause's own when it has one
    /// (<see cref="ConflictTitles"/>) and otherwise the command's for that failure.
    /// </summary>
    private ObjectResult Refused<T>(MasterDataResult<T> result, Titles titles) where T : class
    {
        var (status, title, fallback) = result.Failure switch
        {
            MasterDataFailure.Forbidden => (403, titles.Forbidden, "forbidden"),
            MasterDataFailure.NotFound => (404, titles.NotFound, "not_found"),
            MasterDataFailure.Invalid => (400, titles.Invalid, DemoFlightCodes.Invalid),
            _ when result.Code is { } code && ConflictTitles.TryGetValue(code, out var own) => (409, own, code),
            _ => (409, titles.Conflict, "version_conflict"),
        };
        var problem = MasterDataHttp.Coded(this, status, title, result.Code ?? fallback);
        // A refused stand names the rules it breaks (stand_taken, shift_not_compatible…), as the import does.
        if (result.Reasons is { Count: > 0 } reasons && problem.Value is ProblemDetails details)
            details.Extensions["reasons"] = reasons;
        return problem;
    }

    private static DemoFlightResponse Map(DemoFlightData flight) => new(flight.Id, flight.StationId, flight.StationCode,
        flight.AirlineId, flight.AirlineName, flight.ArrivalFlightNumber, flight.DepartureFlightNumber,
        flight.AircraftRegistration, flight.AircraftModel, flight.OriginIata, flight.DestinationIata,
        flight.SuggestedStandCode, flight.State, flight.Phase, flight.AppearAt, flight.TouchdownAt, flight.OnBlockAt,
        flight.ScheduledOffBlockAt, flight.OffBlockAt, flight.TakeoffAt, flight.VanishAt, flight.Imported,
        flight.TurnaroundId, flight.OperationCode, flight.StandCode, flight.OperationStatus);

    private static DemoStationLayoutResponse Map(DemoStationLayoutData layout) => new(layout.StationId, layout.StationCode,
        layout.Supported, layout.CatalogTerminals, layout.Terminals, layout.CatalogStands, layout.Stands,
        layout.ActiveStands, layout.LocatedStands, layout.MissingStands.ToArray(), layout.UnmatchedStands.ToArray(),
        layout.Complete);

    private static DemoFlightOptionsResponse Map(DemoFlightOptionsData options) => new(options.Enabled, options.ServerTime,
        options.Stations.Select(station => new DemoStationOptionResponse(station.Id, station.Code, station.Name)).ToArray(),
        options.StationId, options.OperationDate,
        options.Airlines.Select(airline => new DemoAirlineOptionResponse(airline.Id, airline.Name, airline.IataCode,
            airline.IcaoCode)).ToArray(),
        options.Airports.Select(airport => new DemoAirportOptionResponse(airport.IataCode, airport.IcaoCode, airport.Name,
            airport.City, airport.CountryCode)).ToArray(),
        options.AircraftTypes.Select(type => new DemoAircraftTypeOptionResponse(type.Id, type.IcaoCode, type.Manufacturer,
            type.Model, type.SizeCategory)).ToArray(),
        options.Stands.Select(stand => new DemoStandOptionResponse(stand.StandId, stand.Code, stand.TerminalCode,
            stand.Located, stand.Free, stand.CoveredBy.ToArray(), stand.EligibleAgents, stand.Eligible,
            stand.Reasons.ToArray())).ToArray(),
        new DemoFlightLimitsResponse(options.Limits.MinMinutesToOnBlock, options.Limits.MaxMinutesToOnBlock,
            options.Limits.DefaultMinutesToOnBlock, options.Limits.MinGroundMinutes, options.Limits.MaxGroundMinutes,
            options.Limits.DefaultGroundMinutes, options.Limits.MaxActive, options.Limits.Active),
        options.Warnings.Select(warning => new DemoFlightWarningResponse(warning.Code, warning.Reasons.ToArray())).ToArray(),
        options.Layout is { } layout ? Map(layout) : null);
}
