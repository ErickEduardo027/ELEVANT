using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

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

    [HttpPost("{requestId:guid}", Name = "ProvisionCommercialAirline")]
    [ProducesResponseType<CommercialAccountResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> Provision(Guid requestId,
        [FromBody] ProvisionAirlineInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ProvisionAsync(actorId, requestId, input, cancellationToken);
        return result.Failure is null
            ? StatusCode(201, new CommercialAccountResponse(result.AccountId!.Value))
            : Failure(result, "request_unavailable", "invalid_provisioning");
    }

    /// <summary>Sends a new activation link to an airline account that has not activated yet (ADR-0022).</summary>
    [HttpPost("accounts/{accountId:guid}/resend-invitation", Name = "ResendAirlineInvitation")]
    [ProducesResponseType<CommercialAccountResponse>(StatusCodes.Status202Accepted, "application/json")]
    public async Task<IActionResult> ResendInvitation(Guid accountId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ResendInvitationAsync(actorId, accountId, cancellationToken);
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
            ProvisioningFailure.Conflict => (409, "El aprovisionamiento ya no es posible en el estado actual.",
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
