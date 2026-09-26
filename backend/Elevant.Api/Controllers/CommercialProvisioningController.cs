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
        return result.Failure switch
        {
            null => StatusCode(201, new CommercialAccountResponse(result.AccountId!.Value)),
            ProvisioningFailure.Forbidden => Forbid(),
            ProvisioningFailure.NotFound => Problem(statusCode: 404, title: "Provisioning request not found."),
            ProvisioningFailure.Conflict => Problem(statusCode: 409, title: "Provisioning request is no longer available."),
            ProvisioningFailure.Invalid => Problem(statusCode: 400, title: "Email or temporary password is invalid."),
            _ => throw new InvalidOperationException(),
        };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;
}
