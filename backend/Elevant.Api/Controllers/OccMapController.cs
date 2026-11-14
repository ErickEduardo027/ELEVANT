using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.MapFlights;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// The three reads of the OCC map (ADR-0042, contracts 1.3), for AVIAM internal staff with the station in scope and any
/// of the map permissions (dashboard, flight monitoring, positions map or planning): the live aircraft around the station
/// with live traffic, served from memory; one aircraft's trail; and the ELEVANT flights of the station. Nothing here
/// writes. A failure of the network travels in the air picture's 200 with its state; every refusal carries a stable code
/// and a Spanish title the screens never show: <c>invalid_map_query</c> (400), <c>forbidden</c> (403) and
/// <c>not_found</c> (404). A 401 carries no code.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[OccMapProblemDetails]
[Route("api/v{version:apiVersion}/occ/map")]
public sealed class OccMapController(GetOccAirPictureHandler airPicture, GetOccAircraftTrackHandler track,
    GetOccMapFlightsHandler flights) : ControllerBase
{
    /// <summary>
    /// The live aircraft around the station, each with the ELEVANT flight it is. <c>trails</c> is <c>short</c> (default:
    /// up to eight points of each trail) or <c>none</c>. The state of the picture (<c>Live</c>, <c>Stale</c>,
    /// <c>Warming</c>, <c>Unavailable</c>, <c>Disabled</c>) and the credit of the network come in the 200; screens ask
    /// again after <c>refreshAfterSeconds</c>. Only the station with live traffic has a picture.
    /// </summary>
    [HttpGet("air-picture", Name = "GetOccAirPicture")]
    [ProducesResponseType<OccAirPictureResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccAirPictureResponse>> GetAirPicture([FromQuery, BindRequired] Guid stationId,
        [FromQuery] string? trails, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccMapProblems.Unauthenticated(this);
        var result = await airPicture.HandleAsync(accountId, stationId, trails, cancellationToken);
        if (result.Failure is { } failure) return OccMapProblems.Of(this, failure);

        var data = result.Value!;
        var picture = data.Picture;
        return Ok(new OccAirPictureResponse(data.StationId, picture.Status, picture.Reason, picture.ServerTime,
            picture.ObservedAt, picture.AgeSeconds, picture.RefreshAfterSeconds, Source(picture.Source),
            new OccAirPictureCenterResponse(data.Center.Latitude, data.Center.Longitude, data.Center.RadiusNm),
            picture.Aircraft.Select(item =>
            {
                var aircraft = item.Aircraft;
                var match = data.Matches.GetValueOrDefault(aircraft.Hex);
                return new OccAirPictureAircraftResponse(aircraft.Hex, aircraft.Callsign, aircraft.Registration,
                    aircraft.TypeIcaoCode, aircraft.Category, aircraft.Latitude, aircraft.Longitude, aircraft.AltitudeFeet,
                    aircraft.OnGround, aircraft.GroundSpeedKnots, aircraft.TrackDegrees, aircraft.VerticalRateFeetPerMinute,
                    aircraft.Squawk, aircraft.PositionAt, match?.FlightKey, match?.MatchedBy,
                    item.Trail.Select(Point).ToArray());
            }).ToArray()));
    }

    /// <summary>
    /// The trail of one live aircraft from memory: its last segment, at most 600 points, oldest first. <c>hex</c> is its
    /// ICAO 24-bit address, six hexadecimal digits; an address no read saw lately is not found.
    /// </summary>
    [HttpGet("aircraft/{hex}/track", Name = "GetOccAircraftTrack")]
    [ProducesResponseType<OccAircraftTrackResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccAircraftTrackResponse>> GetAircraftTrack([FromRoute] string hex,
        [FromQuery, BindRequired] Guid stationId, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccMapProblems.Unauthenticated(this);
        var result = await track.HandleAsync(accountId, stationId, hex, cancellationToken);
        if (result.Failure is { } failure) return OccMapProblems.Of(this, failure);

        var data = result.Value!;
        return Ok(new OccAircraftTrackResponse(data.Hex, data.ServerTime, Source(data.Source),
            data.Points.Select(Point).ToArray()));
    }

    /// <summary>
    /// The ELEVANT flights of the station from <c>hoursBack</c> hours before now (0 to 24, default 2) to
    /// <c>hoursAhead</c> hours after it (1 to 36, default 12), and the legs of every aircraft on the ground now: one row
    /// per leg of a turnaround and per open proposal of the feed, with stable keys, phase, stand, recorded milestones and
    /// the demo clock. It changes only when OCC's planning does (<c>occ_planning</c>).
    /// </summary>
    [HttpGet("flights", Name = "GetOccMapFlights")]
    [ProducesResponseType<OccMapFlightsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccMapFlightsResponse>> GetFlights([FromQuery, BindRequired] Guid stationId,
        [FromQuery] int? hoursBack, [FromQuery] int? hoursAhead, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccMapProblems.Unauthenticated(this);
        var result = await flights.HandleAsync(accountId, stationId, hoursBack, hoursAhead, cancellationToken);
        if (result.Failure is { } failure) return OccMapProblems.Of(this, failure);

        var data = result.Value!;
        return Ok(new OccMapFlightsResponse(data.StationId, data.StationCode, data.ServerTime, data.WindowFrom,
            data.WindowTo, Airport(data.StationAirport), data.Flights.Select(Flight).ToArray()));
    }

    private static OccMapFlightResponse Flight(OccMapFlightData flight) => new(flight.FlightKey, flight.VisitKey,
        flight.ProposalId, flight.LegId, flight.TurnaroundId, flight.Direction, flight.FlightNumber, flight.Callsign,
        new OccMapAirlineResponse(flight.Airline.Id, flight.Airline.Name, flight.Airline.IataCode, flight.Airline.IcaoCode),
        flight.Counterpart is { } counterpart ? Airport(counterpart) : null, flight.ScheduledAt, flight.EstimatedAt,
        flight.ActualAt, flight.ActualKind, flight.Phase, flight.ProviderStatus,
        flight.Aircraft is { } aircraft
            ? new OccMapAircraftResponse(aircraft.Registration, aircraft.TypeIcaoCode, aircraft.Model, aircraft.SizeCategory)
            : null,
        flight.Imported,
        flight.Turnaround is { } turnaround
            ? new OccMapTurnaroundResponse(turnaround.Id, turnaround.OperationCode, turnaround.Status, turnaround.OperationId,
                turnaround.OperationStatus)
            : null,
        flight.Stand is { } stand ? new OccMapStandResponse(stand.Id, stand.Code, stand.TerminalCode) : null,
        flight.SuggestedStandCode,
        flight.Milestones.Select(milestone => new OccMapMilestoneResponse(milestone.Code, milestone.ActualAt)).ToArray(),
        flight.IsDemo,
        flight.Demo is { } demo
            ? new OccMapDemoResponse(demo.DemoFlightId, demo.State, demo.Phase, demo.AppearAt, demo.TouchdownAt,
                demo.OnBlockAt, demo.ScheduledOffBlockAt, demo.OffBlockAt, demo.TakeoffAt, demo.VanishAt)
            : null);

    private static OccMapAirportResponse Airport(OccMapAirportData airport) =>
        new(airport.IataCode, airport.IcaoCode, airport.Name, airport.Latitude, airport.Longitude);

    private static OccAirTrafficSourceResponse? Source(AirTrafficAttribution? source) =>
        source is null ? null : new(source.Name, source.HomeUrl, source.LicenseName, source.LicenseUrl);

    private static OccAirTrailPointResponse Point(AirTrailPoint point) =>
        new(point.At, point.Latitude, point.Longitude, point.AltitudeFeet, point.OnGround);

    private bool TryAccount(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}

/// <summary>
/// Problem Details of the OCC map (ADR-0042): a Spanish title the screens never show and the stable <c>code</c> they
/// translate. A malformed query is 400 <c>invalid_map_query</c>; someone outside AVIAM's internal staff or without a map
/// permission 403 <c>forbidden</c>; a station outside the caller's scope (or without an air picture) and an aircraft no
/// read saw lately 404 <c>not_found</c>. A 401 carries no code.
/// </summary>
internal static class OccMapProblems
{
    public const string InvalidQueryCode = "invalid_map_query";
    public const string ForbiddenCode = "forbidden";
    public const string NotFoundCode = "not_found";

    public const string InvalidQueryTitle = "La consulta del mapa no es válida.";
    public const string ForbiddenTitle = "No tiene acceso a los mapas de esta estación.";
    public const string NotFoundTitle = "La estación o el avión no está disponible en el mapa.";

    public static ObjectResult Of(ControllerBase controller, OccMapFailure failure) => failure switch
    {
        OccMapFailure.Unauthorized => Unauthenticated(controller),
        OccMapFailure.Forbidden => Coded(controller, StatusCodes.Status403Forbidden, ForbiddenTitle, ForbiddenCode),
        OccMapFailure.NotFound => Coded(controller, StatusCodes.Status404NotFound, NotFoundTitle, NotFoundCode),
        _ => InvalidQuery(controller),
    };

    /// <summary>400 <c>invalid_map_query</c>: the station, the window, the trail choice or the address is not valid.</summary>
    public static ObjectResult InvalidQuery(ControllerBase controller) =>
        Coded(controller, StatusCodes.Status400BadRequest, InvalidQueryTitle, InvalidQueryCode);

    /// <summary>401 without a code, with the Bearer challenge.</summary>
    public static ObjectResult Unauthenticated(ControllerBase controller)
    {
        controller.Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails
        {
            Status = StatusCodes.Status401Unauthorized, Title = "La sesión no es válida.",
            Instance = controller.HttpContext.Request.Path,
        }) { StatusCode = StatusCodes.Status401Unauthorized };
    }

    private static ObjectResult Coded(ControllerBase controller, int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}

/// <summary>
/// Answers the model-binding failures of the map reads (no station, a malformed station, a window that is not a whole
/// number) with 400 <c>invalid_map_query</c> instead of the framework's uncoded validation problem. It runs before the
/// <c>[ApiController]</c> model-state filter (order −2000), so that filter never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class OccMapProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid && context.Controller is ControllerBase controller)
            context.Result = OccMapProblems.InvalidQuery(controller);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
