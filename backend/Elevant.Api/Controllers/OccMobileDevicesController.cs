using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Integration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// OCC's shared tablets (2-N02) under <c>operations.devices.*</c>: who holds each one at a station, freeing a tablet
/// and revoking a lost one. Commands take an Idempotency-Key and the binding token on screen (<c>version</c>);
/// every failure carries a stable Problem Details <c>code</c>.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/devices")]
public sealed class OccMobileDevicesController(IMobileDeviceAdministrationStore store) : ControllerBase
{
    [HttpGet(Name = "ListOccMobileDevices")]
    [ProducesResponseType<OccMobileDevicesData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery, BindRequired] Guid stationId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthenticated();
        return Answer(await store.ListAsync(actorId, stationId, cancellationToken));
    }

    /// <summary>Frees the tablet: the next agent who signs in on it holds it, whatever the previous agent was doing.</summary>
    [HttpPost("{deviceId:guid}/unbinding", Name = "UnbindOccMobileDevice")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<OccMobileDeviceData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Unbind(Guid deviceId, [FromBody, BindRequired] UnbindMobileDeviceInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthenticated();
        return Answer(await store.UnbindAsync(actorId, deviceId, input, idempotencyKey, cancellationToken));
    }

    /// <summary>
    /// Revokes a lost tablet with a reason: the installation never registers again and the sessions of the account
    /// that held it last end, also when OCC had freed it, unless that agent signed out of it.
    /// </summary>
    [HttpPost("{deviceId:guid}/revocation", Name = "RevokeOccMobileDevice")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<OccMobileDeviceData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Revoke(Guid deviceId, [FromBody, BindRequired] RevokeMobileDeviceInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthenticated();
        return Answer(await store.RevokeAsync(actorId, deviceId, input, idempotencyKey, cancellationToken));
    }

    private ObjectResult Answer<T>(MobileDeviceAdministrationResult<T> result) where T : class =>
        result.Failure switch
        {
            null => Ok(result.Value),
            MobileDeviceAdministrationFailure.Forbidden => Coded(403, "No tiene permiso para gestionar las tablets.",
                result.Code ?? "forbidden"),
            MobileDeviceAdministrationFailure.NotFound => Coded(404, "La tablet o la estación no está en su alcance.",
                result.Code ?? "not_found"),
            MobileDeviceAdministrationFailure.Invalid => Coded(400, "Los datos no son válidos.",
                result.Code ?? "invalid_mobile_device"),
            _ => Coded(409, "La tablet cambió; vuelva a cargar la lista.", result.Code ?? "version_conflict"),
        };

    private ObjectResult Coded(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }

    private ObjectResult Unauthenticated()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails
        {
            Status = 401, Title = "La sesión no es válida.", Instance = HttpContext.Request.Path,
        }) { StatusCode = 401 };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
