using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration.AviationReference;
using Elevant.Contracts.Commercial;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// The OCC's reference reads from AeroDataBox (ADR-0028 and ADR-0043, notes of 15 November 2026): an aircraft by its
/// registration, the daily routes from the station's airport and the current delays of an airport, for the same readers
/// as the OCC map (AVIAM internal staff with the station in scope and a map permission). The API asks the provider only
/// when its cache has no fresh answer and the read's daily and monthly caps allow it; the state of each read travels in
/// the 200. Refusals carry a stable code: <c>invalid_aviation_reference_query</c> (400), <c>forbidden</c> (403) and
/// <c>not_found</c> (404). A 401 carries no code.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[AviationReferenceProblemDetails]
[Route("api/v{version:apiVersion}/occ/aviation")]
public sealed class OccAviationReferenceController(GetOccAviationReferenceHandler handler) : ControllerBase
{
    /// <summary>
    /// The aircraft with the registration (tail number), kept a day. A demo flight's registration answers
    /// <c>NotApplicable</c> and is never asked of the provider.
    /// </summary>
    [HttpGet("aircraft", Name = "GetOccAircraftReference")]
    [ProducesResponseType<OccAircraftReferenceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccAircraftReferenceResponse>> GetAircraft([FromQuery, BindRequired] Guid stationId,
        [FromQuery, BindRequired] string registration, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return AviationReferenceProblems.Unauthenticated(this);
        var result = await handler.AircraftAsync(accountId, stationId, registration, cancellationToken);
        if (result.Failure is { } failure) return AviationReferenceProblems.Of(this, failure);
        var data = result.Value!;
        return Ok(new OccAircraftReferenceResponse(stationId, data.Subject, data.Status.ToString(), data.ServerTime,
            data.RetrievedAt, AviationReferenceProblems.Source,
            data.Value is { } aircraft ? AviationReferenceMapper.Aircraft(aircraft) : null));
    }

    /// <summary>The routes and average daily flights from the station's airport, kept 24 hours.</summary>
    [HttpGet("routes", Name = "GetOccAirportRoutes")]
    [ProducesResponseType<OccAirportRoutesResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccAirportRoutesResponse>> GetRoutes([FromQuery, BindRequired] Guid stationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return AviationReferenceProblems.Unauthenticated(this);
        var result = await handler.RoutesAsync(accountId, stationId, cancellationToken);
        if (result.Failure is { } failure) return AviationReferenceProblems.Of(this, failure);
        var data = result.Value!;
        return Ok(new OccAirportRoutesResponse(stationId, data.Subject, data.Status.ToString(), data.ServerTime,
            data.RetrievedAt, AviationReferenceProblems.Source,
            data.Value?.Routes.Select(route => new OccAirportRouteResponse(route.DestinationIata, route.DestinationIcao,
                route.Name, route.City, route.CountryCode, route.Latitude, route.Longitude, route.AverageDailyFlights,
                route.Operators)).ToArray() ?? []));
    }

    /// <summary>
    /// The current delays of the station's airport, or of <paramref name="airport"/> (IATA or ICAO) when given: the
    /// origin or destination of a selected flight. Kept an hour per airport.
    /// </summary>
    [HttpGet("delays", Name = "GetOccAirportDelays")]
    [ProducesResponseType<OccAirportDelaysResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccAirportDelaysResponse>> GetDelays([FromQuery, BindRequired] Guid stationId,
        [FromQuery] string? airport, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return AviationReferenceProblems.Unauthenticated(this);
        var result = await handler.DelaysAsync(accountId, stationId, airport, cancellationToken);
        if (result.Failure is { } failure) return AviationReferenceProblems.Of(this, failure);
        var data = result.Value!;
        return Ok(new OccAirportDelaysResponse(stationId, data.Subject, data.Status.ToString(), data.ServerTime,
            data.RetrievedAt, AviationReferenceProblems.Source, data.Value is { } delays
                ? new OccAirportDelayFactsResponse(delays.AirportIcao, delays.From, delays.To, Batch(delays.Arrivals),
                    Batch(delays.Departures))
                : null));
    }

    private static OccDelayBatchResponse Batch(DelayBatch batch) =>
        new(batch.Total, batch.Qualified, batch.Cancelled, batch.MedianDelayMinutes, batch.DelayIndex);

    private bool TryAccount(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}

/// <summary>
/// The fleet of an airline as AeroDataBox knows it (ADR-0028, note of 15 November 2026), for Contratos' intake and the
/// superadministrator's airline catalog: a superadministrator, or AVIAM internal staff with <c>contracts.requests.read</c>.
/// Kept seven days per airline. It informs; it blocks no approval. Refusals use the codes of
/// <see cref="OccAviationReferenceController"/>.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[AviationReferenceProblemDetails]
[Route("api/v{version:apiVersion}/contracts/airline-fleet")]
public sealed class AirlineFleetController(GetAirlineFleetHandler handler) : ControllerBase
{
    /// <summary>The fleet size and type mix of the airline with ICAO (3 letters) or IATA (2 characters) code <paramref name="airlineCode"/>.</summary>
    [HttpGet(Name = "GetAirlineFleet")]
    [ProducesResponseType<AirlineFleetResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<ActionResult<AirlineFleetResponse>> GetFleet([FromQuery, BindRequired] string airlineCode,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId) || accountId == Guid.Empty)
            return AviationReferenceProblems.Unauthenticated(this);
        var result = await handler.HandleAsync(accountId, airlineCode, cancellationToken);
        if (result.Failure is { } failure) return AviationReferenceProblems.Of(this, failure);
        var data = result.Value!;
        var sample = data.Value?.Sample ?? [];
        var types = sample.GroupBy(aircraft => aircraft.IcaoType ?? aircraft.Model ?? aircraft.TypeName ?? "?",
                StringComparer.Ordinal)
            .Select(group => new AirlineFleetTypeResponse(group.First().IcaoType,
                group.Select(aircraft => aircraft.Model ?? aircraft.TypeName).FirstOrDefault(model => model is not null) ??
                group.Key,
                group.Count()))
            .OrderByDescending(type => type.Count).ThenBy(type => type.Model, StringComparer.Ordinal).ToArray();
        return Ok(new AirlineFleetResponse(data.Subject, data.Status.ToString(), data.ServerTime, data.RetrievedAt,
            AviationReferenceProblems.Source, data.Value?.TotalAircraft, sample.Count, types));
    }
}

/// <summary>Maps the reference values to their contracts.</summary>
internal static class AviationReferenceMapper
{
    public static AircraftReferenceResponse Aircraft(AircraftFacts aircraft) => new(aircraft.Registration, aircraft.Active,
        aircraft.Model, aircraft.TypeName, aircraft.IcaoType, aircraft.IataType, aircraft.Operator, aircraft.Serial,
        aircraft.ModeS, aircraft.Seats, aircraft.Engines, aircraft.EngineType, aircraft.AgeYears, aircraft.FirstFlight,
        aircraft.Delivered, aircraft.Registered, aircraft.IsFreighter);
}

/// <summary>
/// Problem Details of the reference reads: a Spanish title the screens never show and the stable <c>code</c> they
/// translate. A missing or malformed parameter is 400 <c>invalid_aviation_reference_query</c>; a caller without the
/// permission 403 <c>forbidden</c>; a station outside the caller's scope, unknown, inactive or without an ICAO airport 404
/// <c>not_found</c>. A 401 carries no code.
/// </summary>
internal static class AviationReferenceProblems
{
    /// <summary>The credit shown wherever the data is.</summary>
    public const string Source = "AeroDataBox";

    public const string InvalidQueryCode = "invalid_aviation_reference_query";

    public static ObjectResult Of(ControllerBase controller, AviationReferenceFailure failure) => failure switch
    {
        AviationReferenceFailure.Unauthorized => Unauthenticated(controller),
        AviationReferenceFailure.Forbidden => Coded(controller, StatusCodes.Status403Forbidden,
            "No tiene acceso a estos datos de referencia.", "forbidden"),
        AviationReferenceFailure.NotFound => Coded(controller, StatusCodes.Status404NotFound,
            "La estación no está disponible para estos datos.", "not_found"),
        _ => InvalidQuery(controller),
    };

    public static ObjectResult InvalidQuery(ControllerBase controller) =>
        Coded(controller, StatusCodes.Status400BadRequest, "La consulta de datos de referencia no es válida.", InvalidQueryCode);

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
/// Answers the model-binding failures of the reference reads with 400 <c>invalid_aviation_reference_query</c>, before the
/// <c>[ApiController]</c> model-state filter (order −2000).
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class AviationReferenceProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid && context.Controller is ControllerBase controller)
            context.Result = AviationReferenceProblems.InvalidQuery(controller);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
