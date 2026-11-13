using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Contracts.Integration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Elevant.Api.Controllers;

/// <summary>
/// The demo flights of the superadministrator (ADR-0041): a pair of flight proposals of the provider «Demo» that OCC
/// sees coming, imports and operates like any other flight. The endpoints exist in every environment; where
/// <c>DemoFlights:Mode</c> is off every command answers <c>demo_flights_unavailable</c> and the reads answer
/// <c>enabled: false</c>. Every failure carries a stable code and a Spanish title.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/governance")]
public sealed class DemoFlightsController(DemoFlightHandler handler) : ControllerBase
{
    private const string ForbiddenTitle = "Solo el superadministrador dispara vuelos demo.";

    /// <summary>
    /// What the form «Disparar vuelo demo» offers at a station (the requested one, else Punta Cana, else the first):
    /// airlines with exactly one applicable contract today, airports, aircraft types, stands, limits and warnings.
    /// </summary>
    [HttpGet("demo-flights/options", Name = "GetDemoFlightOptions")]
    [ProducesResponseType<DemoFlightOptionsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Options([FromQuery] Guid? stationId, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        // The stands are evaluated for the form's default visit (8 minutes to the stand, 60 on the ground) and any size.
        var options = await handler.OptionsAsync(actorId, DemoFlightOptionsQuery.Default(stationId), cancellationToken);
        return options is null ? MasterDataHttp.Coded(this, 403, ForbiddenTitle, "forbidden") : Ok(Map(options));
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
            ? MasterDataHttp.Coded(this, 403, ForbiddenTitle, "forbidden")
            : Ok(new DemoFlightListResponse(list.Enabled, list.ServerTime, list.StationId, list.Flights.Select(Map).ToArray()));
    }

    /// <summary>
    /// «Disparar vuelo demo»: 201 with the new flight, 200 when the Idempotency-Key replays it. The flight numbers and the
    /// registration are generated; a taken or inactive stand answers <c>stand_unavailable</c> with its rules in
    /// <c>reasons</c>.
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
            : Refused(result);
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
        return result.Value is { } flight && result.Failure is null ? Ok(Map(flight)) : Refused(result);
    }

    /// <summary>The Problem Details of a refused command: a Spanish title by cause and the store's code.</summary>
    private ObjectResult Refused(MasterDataResult<DemoFlightData> result)
    {
        var (status, title, fallback) = result.Failure switch
        {
            MasterDataFailure.Forbidden => (403, ForbiddenTitle, "forbidden"),
            MasterDataFailure.NotFound => (404, "La estación o el vuelo demo ya no existe.", "not_found"),
            MasterDataFailure.Invalid => (400, "Los datos del vuelo demo no son válidos.", DemoFlightCodes.Invalid),
            _ when result.Code == DemoFlightCodes.Unavailable =>
                (409, "Los vuelos demo no están disponibles en este entorno.", DemoFlightCodes.Unavailable),
            _ => (409, "El vuelo demo no se puede crear o cambió. Vuelva a cargar los datos.", "version_conflict"),
        };
        var problem = MasterDataHttp.Coded(this, status, title, result.Code ?? fallback);
        // A refused stand names the rules it breaks (stand_taken, stand_cancelled…), as the import does.
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

    private static DemoFlightOptionsResponse Map(DemoFlightOptionsData options) => new(options.Enabled, options.ServerTime,
        options.Stations.Select(station => new DemoStationOptionResponse(station.Id, station.Code, station.Name)).ToArray(),
        options.StationId, options.OperationDate,
        options.Airlines.Select(airline => new DemoAirlineOptionResponse(airline.Id, airline.Name, airline.IataCode,
            airline.IcaoCode)).ToArray(),
        options.Airports.Select(airport => new DemoAirportOptionResponse(airport.IataCode, airport.IcaoCode, airport.Name,
            airport.City, airport.CountryCode)).ToArray(),
        options.AircraftTypes.Select(type => new DemoAircraftTypeOptionResponse(type.Id, type.IcaoCode, type.Manufacturer,
            type.Model, type.SizeCategory)).ToArray(),
        options.Stands.Select(stand => new DemoStandOptionResponse(stand.StandId, stand.Code, stand.TerminalCode, stand.Free))
            .ToArray(),
        new DemoFlightLimitsResponse(options.Limits.MinMinutesToOnBlock, options.Limits.MaxMinutesToOnBlock,
            options.Limits.DefaultMinutesToOnBlock, options.Limits.MinGroundMinutes, options.Limits.MaxGroundMinutes,
            options.Limits.DefaultGroundMinutes, options.Limits.MaxActive, options.Limits.Active),
        options.Warnings.Select(warning => new DemoFlightWarningResponse(warning.Code, warning.Reasons.ToArray())).ToArray());
}
