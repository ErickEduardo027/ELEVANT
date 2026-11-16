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
/// Portal accounts of the approved requests (ADR-0022, 1-N13): the superadministrator creates the
/// account, links an existing one or queues a new invitation. Commands take an Idempotency-Key and
/// the version the superadministrator saw; every failure is Problem Details with a stable code.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/governance/provisioning")]
public sealed class CommercialProvisioningController(
    ICommercialProvisioningStore store) : ControllerBase
{
    [HttpGet(Name = "ListCommercialProvisioning")]
    [ProducesResponseType<ProvisioningTaskData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var tasks = await store.ListPendingAsync(actorId, cancellationToken);
        return tasks is null ? Forbid() : Ok(tasks);
    }

    /// <summary>
    /// Creates the airline's portal account: an emailed invitation by default, a temporary password
    /// as the explicit alternative. The Idempotency-Key and <c>expectedVersion</c> (the request
    /// version) are optional while older clients exist (expand); a key without the version is
    /// rejected. An email that already has an account answers <c>email_has_account</c> when it can be
    /// linked instead.
    /// </summary>
    [HttpPost("{requestId:guid}", Name = "ProvisionCommercialAirline")]
    [ProducesResponseType<CommercialAccountResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> Provision(Guid requestId,
        [FromBody] ProvisionAirlineInput input, [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ProvisionAsync(actorId, requestId, input, idempotencyKey, cancellationToken);
        return result.Failure is null
            ? StatusCode(201, new CommercialAccountResponse(result.AccountId!.Value))
            : Failure(result, "request_unavailable", "invalid_provisioning");
    }

    /// <summary>
    /// Completes the request with the existing portal account of the email (1-N13): one of the same
    /// airline, or one without an airline, which joins it. Its credentials do not change.
    /// </summary>
    [HttpPost("{requestId:guid}/account-link", Name = "LinkCommercialAirlineAccount")]
    [Consumes("application/json")]
    [ProducesResponseType<CommercialAccountResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> LinkAccount(Guid requestId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] LinkProvisioningAccountInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.LinkAccountAsync(actorId, requestId, idempotencyKey, input, cancellationToken);
        return result.Failure is null
            ? Ok(new CommercialAccountResponse(result.AccountId!.Value))
            : Failure(result, "request_unavailable", "invalid_provisioning");
    }

    /// <summary>
    /// Queues a new activation link for an airline account that has not activated yet (ADR-0022); the
    /// earlier links stop working and their queued emails are discarded. The Idempotency-Key and
    /// <c>expectedVersion</c> (the account version) are optional while older clients exist (expand).
    /// </summary>
    [HttpPost("accounts/{accountId:guid}/resend-invitation", Name = "ResendAirlineInvitation")]
    [ProducesResponseType<CommercialAccountResponse>(StatusCodes.Status202Accepted, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> ResendInvitation(Guid accountId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] ResendInvitationInput? input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ResendInvitationAsync(actorId, accountId, input, idempotencyKey, cancellationToken);
        return result.Failure is null
            ? Accepted(new CommercialAccountResponse(result.AccountId!.Value))
            : Failure(result, "invitation_already_accepted", "invitations_unavailable");
    }

    // Every failure carries a code (the screens explain it); the defaults name the usual cause.
    private IActionResult Failure(ProvisioningResult result, string conflictCode, string invalidCode)
    {
        if (result.Failure == ProvisioningFailure.Forbidden) return Forbid();
        var (status, title, code) = result.Failure switch
        {
            ProvisioningFailure.NotFound => (404, "El registro ya no existe.", result.Code ?? "not_found"),
            ProvisioningFailure.Conflict => (409, "El acceso no es posible en el estado actual.",
                result.Code ?? conflictCode),
            _ => (400, "Los datos del acceso no son válidos.", result.Code ?? invalidCode),
        };
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;
}
