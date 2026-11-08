using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Reference data the ramp agent's tablet reads (3-B): the active aircraft types it offers in «Datos del vuelo». The
/// tablet keeps the list only as a cache; an older server without this endpoint leaves the type read-only.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp")]
public sealed class RampReferenceController(IRampReferenceStore store) : ControllerBase
{
    [HttpGet("aircraft-types", Name = "GetRampAircraftTypes")]
    [ProducesResponseType<RampAircraftTypesResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<ActionResult<RampAircraftTypesResponse>> GetAircraftTypes(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) || actorId == Guid.Empty)
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return new ObjectResult(new ProblemDetails
            {
                Status = 401, Title = "Authentication failed.", Instance = HttpContext.Request.Path,
            }) { StatusCode = 401 };
        }
        var types = await store.ListAircraftTypesAsync(actorId, cancellationToken);
        // A refused permission keeps the uncoded 403 of every ramp controller.
        if (types is null)
            return new ObjectResult(new ProblemDetails
            {
                Status = StatusCodes.Status403Forbidden, Title = "Solo un agente de rampa consulta los tipos de avión.",
                Instance = HttpContext.Request.Path,
            }) { StatusCode = StatusCodes.Status403Forbidden };
        return Ok(new RampAircraftTypesResponse(types.Select(type => new RampAircraftTypeResponse(type.Id, type.IcaoCode,
            type.IataCode, type.Manufacturer, type.Model)).ToArray()));
    }
}
