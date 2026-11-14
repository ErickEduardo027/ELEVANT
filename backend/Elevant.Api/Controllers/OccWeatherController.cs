using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.Weather;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// The weather of a station's airport for the OCC (ADR-0043, contracts 1.4): its METAR and its TAF from aviationweather.gov,
/// for the same readers as the OCC map (AVIAM internal staff with the station in scope and any of the map permissions:
/// dashboard, flight monitoring, positions map or planning). Nothing here writes. The state of the weather travels in the
/// 200; every refusal carries a stable code and a Spanish title the screens never show: <c>invalid_weather_query</c>
/// (400), <c>forbidden</c> (403) and <c>not_found</c> (404). A 401 carries no code.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[OccWeatherProblemDetails]
[Route("api/v{version:apiVersion}/occ/weather")]
public sealed class OccWeatherController(GetOccAerodromeWeatherHandler weather) : ControllerBase
{
    /// <summary>
    /// The METAR (decoded basics and raw text) and the TAF (raw text and periods) of the station's airport, which the API
    /// keeps a few minutes. The state of the weather (<c>Live</c>, <c>Stale</c>, <c>Unavailable</c>, <c>Disabled</c>)
    /// and the credit of the weather service come in the 200; a station outside the reader's scope is not found.
    /// </summary>
    [HttpGet(Name = "GetOccAerodromeWeather")]
    [ProducesResponseType<OccAerodromeWeatherResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccAerodromeWeatherResponse>> GetWeather([FromQuery, BindRequired] Guid stationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccWeatherProblems.Unauthenticated(this);
        var result = await weather.HandleAsync(accountId, stationId, cancellationToken);
        if (result.Failure is { } failure) return OccWeatherProblems.Of(this, failure);

        var data = result.Value!;
        return Ok(new OccAerodromeWeatherResponse(data.StationId, data.IcaoCode, data.Status, data.ServerTime,
            data.RetrievedAt, new OccWeatherSourceResponse(data.Source.Name, data.Source.HomeUrl),
            data.Metar is { } metar ? Metar(metar) : null, data.Taf is { } taf ? Taf(taf) : null));
    }

    private static OccMetarResponse Metar(AerodromeMetar metar) => new(metar.Raw, metar.ObservedAt, metar.FlightCategory,
        metar.WindDirectionDegrees, metar.WindVariable, metar.WindSpeedKnots, metar.WindGustKnots,
        metar.VisibilityStatuteMiles, metar.TemperatureCelsius, metar.DewpointCelsius, metar.AltimeterHectopascals,
        metar.Weather, Clouds(metar.Clouds));

    private static OccTafResponse Taf(AerodromeTaf taf) => new(taf.Raw, taf.IssuedAt, taf.ValidFrom, taf.ValidTo,
        taf.Periods.Select(period => new OccTafPeriodResponse(period.From, period.To, period.Change,
            period.ProbabilityPercent, period.WindDirectionDegrees, period.WindVariable, period.WindSpeedKnots,
            period.WindGustKnots, period.VisibilityStatuteMiles, period.Weather, Clouds(period.Clouds))).ToArray());

    private static OccCloudLayerResponse[] Clouds(IReadOnlyList<AerodromeCloudLayer> clouds) =>
        clouds.Select(cloud => new OccCloudLayerResponse(cloud.Cover, cloud.BaseFeet)).ToArray();

    private bool TryAccount(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}

/// <summary>
/// Problem Details of the OCC's weather (ADR-0043): a Spanish title the screens never show and the stable <c>code</c> they
/// translate. A missing or malformed station is 400 <c>invalid_weather_query</c>; someone outside AVIAM's internal staff
/// or without a map permission 403 <c>forbidden</c>; a station outside the caller's scope, unknown, inactive or whose
/// airport has no ICAO code 404 <c>not_found</c>. A 401 carries no code.
/// </summary>
internal static class OccWeatherProblems
{
    public const string InvalidQueryCode = "invalid_weather_query";
    public const string ForbiddenCode = "forbidden";
    public const string NotFoundCode = "not_found";

    public const string InvalidQueryTitle = "La consulta del clima no es válida.";
    public const string ForbiddenTitle = "No tiene acceso al clima de esta estación.";
    public const string NotFoundTitle = "La estación no está disponible para el clima.";

    public static ObjectResult Of(ControllerBase controller, OccMapFailure failure) => failure switch
    {
        OccMapFailure.Unauthorized => Unauthenticated(controller),
        OccMapFailure.Forbidden => Coded(controller, StatusCodes.Status403Forbidden, ForbiddenTitle, ForbiddenCode),
        OccMapFailure.NotFound => Coded(controller, StatusCodes.Status404NotFound, NotFoundTitle, NotFoundCode),
        _ => InvalidQuery(controller),
    };

    /// <summary>400 <c>invalid_weather_query</c>: the station is missing or is not a valid id.</summary>
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
/// Answers the model-binding failures of the weather read (no station, a station that is not an id) with 400
/// <c>invalid_weather_query</c> instead of the framework's uncoded validation problem. It runs before the
/// <c>[ApiController]</c> model-state filter (order −2000), so that filter never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class OccWeatherProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid && context.Controller is ControllerBase controller)
            context.Result = OccWeatherProblems.InvalidQuery(controller);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
