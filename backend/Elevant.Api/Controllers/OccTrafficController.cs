using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Read-only regional aircraft observations for authorized PUJ OCC staff.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/traffic")]
public sealed class OccTrafficController(GetOccAircraftTrafficHandler handler) : ControllerBase
{
    [HttpGet("aircraft", Name = "GetOccAircraftTraffic")]
    [ProducesResponseType<OccAircraftTrafficResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<ActionResult<OccAircraftTrafficResponse>> GetAircraft(
        [FromQuery, BindRequired] Guid stationId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId) ||
            accountId == Guid.Empty)
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return Failure(StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await handler.HandleAsync(accountId, stationId, cancellationToken);
        if (!result.IsSuccess)
        {
            return result.Failure switch
            {
                OccAircraftTrafficFailure.Unauthorized => Failure(StatusCodes.Status401Unauthorized, "Authentication failed."),
                OccAircraftTrafficFailure.Forbidden => Failure(StatusCodes.Status403Forbidden, "Access to OCC traffic is forbidden."),
                OccAircraftTrafficFailure.InvalidRequest => Failure(StatusCodes.Status400BadRequest, "The OCC traffic request is invalid."),
                OccAircraftTrafficFailure.NotFound => Failure(StatusCodes.Status404NotFound, "The OCC traffic resource was not found."),
                _ => Failure(StatusCodes.Status503ServiceUnavailable, "Aircraft observations are unavailable."),
            };
        }

        var traffic = result.Traffic!;
        return Ok(new OccAircraftTrafficResponse(
            "OpenSky Network", traffic.ProviderTime, traffic.RetrievedAt, traffic.Stale,
            traffic.Aircraft.Select(item => new OccAircraftStateResponse(
                item.Icao24, item.Callsign, item.OriginCountry, item.Latitude, item.Longitude,
                item.LastPositionAt, item.LastContactAt, item.BarometricAltitudeMeters,
                item.GeometricAltitudeMeters, item.GroundSpeedMetersPerSecond,
                item.TrueTrackDegrees, item.VerticalRateMetersPerSecond, item.OnGround,
                item.Squawk, item.PositionSource, item.Category)).ToArray()));
    }

    private ActionResult<OccAircraftTrafficResponse> Failure(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status };
}
