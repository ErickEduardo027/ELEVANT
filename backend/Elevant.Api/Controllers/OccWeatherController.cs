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
/// and since plan M6 those of every airport of the region around it with the region's SIGMETs, wind grid and radar frames
/// (<c>region</c>, <c>sigmets</c>, <c>wind</c>, <c>radar</c>), for the same readers as the OCC map (AVIAM internal
/// staff with the station in scope and any of the map permissions: dashboard, flight monitoring, positions map or
/// planning). Nothing here writes. The state of the weather travels in the 200; every refusal carries a stable code and a
/// Spanish title the screens never show: <c>invalid_weather_query</c> (400), <c>forbidden</c> (403) and
/// <c>not_found</c> (404). A 401 carries no code.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[OccWeatherProblemDetails]
[Route("api/v{version:apiVersion}/occ/weather")]
public sealed class OccWeatherController(GetOccAerodromeWeatherHandler weather, GetOccRegionWeatherHandler region,
    GetOccRegionWeatherLayersHandler layers) : ControllerBase
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

    /// <summary>
    /// The METAR (raw text, basics, ceiling and the service's flight category) and the TAF (raw text and validity) of every
    /// airport of the region around the station's airport, nearest first, which the API reads for the whole region at
    /// once and keeps a few minutes. Only Punta Cana has a region: the 32 airports the maps draw in Región. The state of
    /// the region (<c>Live</c>, <c>Stale</c>, <c>Unavailable</c>, <c>Disabled</c>) with its reason, when to ask again and
    /// the credit of the weather service come in the 200; a station outside the reader's scope, or whose airport has no
    /// region, is not found.
    /// </summary>
    [HttpGet("region", Name = "GetOccRegionWeather")]
    [ProducesResponseType<OccRegionWeatherResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccRegionWeatherResponse>> GetRegionWeather([FromQuery, BindRequired] Guid stationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccWeatherProblems.Unauthenticated(this);
        var result = await region.HandleAsync(accountId, stationId, cancellationToken);
        if (result.Failure is { } failure) return OccWeatherProblems.Of(this, failure);

        var data = result.Value!;
        return Ok(new OccRegionWeatherResponse(data.StationId, data.Status, data.Reason, data.ServerTime,
            data.RefreshAfterSeconds, new OccRegionWeatherCreditResponse(data.Credit.Name, data.Credit.HomeUrl),
            data.Stations.Select(RegionStation).ToArray()));
    }

    /// <summary>
    /// The international SIGMETs whose area touches the region around the station's airport and are still valid, from
    /// aviationweather.gov, which the API reads once for the region and keeps ten minutes. Their state, reason, when to ask
    /// again and the credit come in the 200; a station outside the reader's scope, or whose airport has no region, is not
    /// found.
    /// </summary>
    [HttpGet("sigmets", Name = "GetOccRegionSigmets")]
    [ProducesResponseType<OccSigmetsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccSigmetsResponse>> GetRegionSigmets([FromQuery, BindRequired] Guid stationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccWeatherProblems.Unauthenticated(this);
        var result = await layers.SigmetsAsync(accountId, stationId, cancellationToken);
        if (result.Failure is { } failure) return OccWeatherProblems.Of(this, failure);

        var data = result.Value!;
        return Ok(new OccSigmetsResponse(data.StationId, data.Status, data.Reason, data.ServerTime, data.RefreshAfterSeconds,
            Credit(data.Credit), data.Sigmets.Select(sigmet => new OccSigmetResponse(sigmet.Id, sigmet.FirId, sigmet.Hazard,
                sigmet.Qualifier, sigmet.ValidFrom, sigmet.ValidTo, sigmet.BaseFeet, sigmet.TopFeet, sigmet.Raw,
                sigmet.Polygon.Select(point => (IReadOnlyList<double>)[point.Longitude, point.Latitude]).ToArray()))
                .ToArray()));
    }

    /// <summary>
    /// The wind 10 m above the ground on a coarse grid over the region around the station's airport, from Open-Meteo,
    /// which the API reads for the whole grid at once and keeps an hour. Its state, reason, when to ask again and the
    /// credit come in the 200; a station outside the reader's scope, or whose airport has no region, is not found.
    /// </summary>
    [HttpGet("wind", Name = "GetOccRegionWind")]
    [ProducesResponseType<OccWindGridResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccWindGridResponse>> GetRegionWind([FromQuery, BindRequired] Guid stationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccWeatherProblems.Unauthenticated(this);
        var result = await layers.WindAsync(accountId, stationId, cancellationToken);
        if (result.Failure is { } failure) return OccWeatherProblems.Of(this, failure);

        var data = result.Value!;
        var grid = data.Grid;
        return Ok(new OccWindGridResponse(data.StationId, data.Status, data.Reason, data.ServerTime, data.RefreshAfterSeconds,
            Credit(data.Credit), data.ValidAt, new OccWindGridAreaResponse(grid.Area.LongitudeMin, grid.Area.LongitudeMax,
                grid.Area.LatitudeMin, grid.Area.LatitudeMax, grid.Columns, grid.Rows,
                grid.Points.Select(point => new OccWindPointResponse(point.Latitude, point.Longitude, point.SpeedKnots,
                    point.DirectionDegrees)).ToArray())));
    }

    /// <summary>
    /// The latest radar scans over the region around the station's airport (San Juan's NEXRAD through the Iowa
    /// Environmental Mesonet), as tile addresses the screens load themselves; the API keeps the index five minutes. Its
    /// state, reason, when to ask again and the credit come in the 200; a station outside the reader's scope, or whose
    /// airport has no region, is not found.
    /// </summary>
    [HttpGet("radar", Name = "GetOccRegionRadar")]
    [ProducesResponseType<OccRadarFramesResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccRadarFramesResponse>> GetRegionRadar([FromQuery, BindRequired] Guid stationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return OccWeatherProblems.Unauthenticated(this);
        var result = await layers.RadarAsync(accountId, stationId, cancellationToken);
        if (result.Failure is { } failure) return OccWeatherProblems.Of(this, failure);

        var data = result.Value!;
        return Ok(new OccRadarFramesResponse(data.StationId, data.Status, data.Reason, data.ServerTime,
            data.RefreshAfterSeconds, Credit(data.Credit), data.Provider, data.MaxZoom,
            data.Frames.Select(frame => new OccRadarFrameResponse(frame.Time, frame.TileUrlTemplate)).ToArray()));
    }

    private static OccRegionWeatherCreditResponse Credit(AerodromeWeatherAttribution credit) => new(credit.Name, credit.HomeUrl);

    private static OccRegionWeatherStationResponse RegionStation(OccRegionStationWeather item) => new(
        item.Station.IcaoCode, item.Station.IataCode, item.Station.Name, item.Station.Latitude, item.Station.Longitude,
        item.Metar is { } metar
            // A variable wind travels without a direction.
            ? new OccRegionMetarResponse(metar.Raw, metar.ObservedAt, metar.WindVariable ? null : metar.WindDirectionDegrees,
                metar.WindSpeedKnots, metar.WindGustKnots, metar.VisibilityStatuteMiles, item.CeilingFeet,
                metar.FlightCategory, metar.TemperatureCelsius, metar.DewpointCelsius, metar.AltimeterHectopascals)
            : null,
        item.Taf is { } taf ? new OccRegionTafResponse(taf.Raw, taf.IssuedAt, taf.ValidFrom, taf.ValidTo) : null);

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
/// airport has no ICAO code (or, for the region read, no region) 404 <c>not_found</c>. A 401 carries no code.
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
/// Answers the model-binding failures of the weather reads (no station, a station that is not an id) with 400
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
