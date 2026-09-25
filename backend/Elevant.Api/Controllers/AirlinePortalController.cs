using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Commercial;
using Elevant.Contracts.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Exposes a tenant-scoped bootstrap for the airline portal.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/airline/portal")]
public sealed class AirlinePortalController(
    GetAirlinePortalBootstrapHandler bootstrapHandler) : ControllerBase
{
    [HttpGet("bootstrap", Name = "GetAirlinePortalBootstrap")]
    [ProducesResponseType<AirlinePortalBootstrapResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlinePortalBootstrapResponse>> GetBootstrap(
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await bootstrapHandler.HandleAsync(accountId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = result.Failure switch
            {
                AirlinePortalFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
                AirlinePortalFailure.Forbidden => (StatusCodes.Status403Forbidden, "Airline portal access is forbidden."),
                AirlinePortalFailure.NotFound => (StatusCodes.Status404NotFound, "Airline portal context was not found."),
                _ => throw new InvalidOperationException("Unsupported airline portal failure."),
            };
            if (statusCode == StatusCodes.Status401Unauthorized)
            {
                Response.Headers.WWWAuthenticate = "Bearer";
            }
            return ProblemResult(statusCode, title);
        }

        var bootstrap = result.Bootstrap!;
        return Ok(new AirlinePortalBootstrapResponse(
            bootstrap.AirlineId,
            bootstrap.OrganizationId,
            bootstrap.IataCode,
            bootstrap.IcaoCode,
            bootstrap.Name,
            bootstrap.Stations.Select(station => new AirlinePortalStationResponse(
                station.Id,
                station.Code,
                station.Name,
                station.IanaTimeZone)).ToArray()));
    }

    private ActionResult<AirlinePortalBootstrapResponse> ProblemResult(int statusCode, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Instance = HttpContext.Request.Path,
        })
        {
            StatusCode = statusCode,
        };
}
