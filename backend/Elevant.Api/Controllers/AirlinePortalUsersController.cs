using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// The airline manages its own portal users (2-N20): every user of the airline reads the list and what it may do;
/// a representative invites users by email, deactivates and reactivates them and marks signers. Only
/// representatives and signers sign contracts and submit the JAC permit. Commands take an Idempotency-Key and,
/// for an existing user, its version; every failure carries a stable Problem Details <c>code</c>.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/airline/portal/users")]
public sealed class AirlinePortalUsersController(IAirlinePortalUserStore store) : ControllerBase
{
    [HttpGet(Name = "GetAirlinePortalUsers")]
    [ProducesResponseType<AirlinePortalUsersData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthenticated();
        return await store.ListAsync(actorId, cancellationToken) is { } users
            ? Ok(users)
            : Coded(403, "Esta cuenta no puede consultar los usuarios del portal.", "forbidden");
    }

    /// <summary>A representative invites a user by email; the activation email is queued, never sent from here.</summary>
    [HttpPost(Name = "InviteAirlinePortalUser")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<AirlinePortalUserData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<AirlinePortalUserData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Invite([FromBody, BindRequired] InviteAirlinePortalUserInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthenticated();
        var result = await store.InviteAsync(actorId, input, idempotencyKey, cancellationToken);
        return result.Failure is null
            ? new ObjectResult(result.User) { StatusCode = result.Replayed ? 200 : 201 }
            : Failure(result);
    }

    /// <summary>A representative deactivates or reactivates another user, never itself nor another representative.</summary>
    [HttpPost("{userId:guid}/status", Name = "SetAirlinePortalUserStatus")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<AirlinePortalUserData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> SetStatus(Guid userId, [FromBody, BindRequired] SetAirlinePortalUserStatusInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthenticated();
        var result = await store.SetStatusAsync(actorId, userId, input, idempotencyKey, cancellationToken);
        return result.Failure is null ? Ok(result.User) : Failure(result);
    }

    /// <summary>A representative lets another user sign contracts and submit the JAC permit, or takes it back.</summary>
    [HttpPost("{userId:guid}/signer", Name = "SetAirlinePortalUserSigner")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<AirlinePortalUserData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> SetSigner(Guid userId, [FromBody, BindRequired] SetAirlinePortalUserSignerInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthenticated();
        var result = await store.SetSignerAsync(actorId, userId, input, idempotencyKey, cancellationToken);
        return result.Failure is null ? Ok(result.User) : Failure(result);
    }

    private ObjectResult Failure(AirlinePortalUserResult result) => result.Failure switch
    {
        AirlinePortalUserFailure.Forbidden => Coded(403, result.Code == "representative_required"
            ? "Solo un representante de la aerolínea gestiona sus usuarios." : "No tiene permiso para esta acción.",
            result.Code ?? "forbidden"),
        AirlinePortalUserFailure.NotFound => Coded(404, "El usuario ya no existe en su aerolínea.", result.Code ?? "not_found"),
        AirlinePortalUserFailure.Invalid => Coded(400, "Los datos del usuario no son válidos.",
            result.Code ?? "invalid_portal_user"),
        _ => Coded(409, "El usuario cambió o no admite este cambio; vuelva a cargar la lista.",
            result.Code ?? "version_conflict"),
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
