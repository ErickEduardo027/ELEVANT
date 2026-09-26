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
[Route("api/v{version:apiVersion}")]
public sealed class ContractDraftsController(IContractDraftStore store) : ControllerBase
{
    [HttpGet("airline/contract-drafts", Name = "GetAirlineContractDrafts")]
    [ProducesResponseType<ContractDraftData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> AirlineDrafts(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var drafts = await store.ListForAirlineAsync(actorId, cancellationToken);
        return drafts is null ? Forbid() : Ok(drafts);
    }

    [HttpPost("airline/contract-drafts/{versionId:guid}/comments", Name = "CommentAirlineContractDraft")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(8192)]
    public async Task<IActionResult> Comment(Guid versionId,
        [FromBody] ContractDraftCommentRequest input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.AddAirlineCommentAsync(actorId, versionId,
            input.Body, cancellationToken);
        return FailureOrSuccess(result, 201);
    }

    [HttpGet("contracts/drafts", Name = "GetManagedContractDrafts")]
    [ProducesResponseType<ContractDraftData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ManagedDrafts(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var drafts = await store.ListForContractsAsync(actorId, cancellationToken);
        return drafts is null ? Forbid() : Ok(drafts);
    }

    [HttpPut("contracts/drafts/{versionId:guid}", Name = "UpdateManagedContractDraft")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> Update(Guid versionId,
        [FromBody] UpdateContractDraftInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return FailureOrSuccess(await store.UpdateAsync(actorId, versionId,
            input, cancellationToken));
    }

    [HttpPost("contracts/drafts/{versionId:guid}/activate", Name = "ActivateManagedContractDraft")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Activate(Guid versionId,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return FailureOrSuccess(await store.ActivateAsync(actorId, versionId,
            cancellationToken));
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private IActionResult FailureOrSuccess(ContractDraftResult result, int successStatus = 200) =>
        result.Failure switch
        {
            null => StatusCode(successStatus, new CommercialIdResponse(result.Id!.Value)),
            ContractDraftFailure.Forbidden => Forbid(),
            ContractDraftFailure.NotFound => Problem(statusCode: 404, title: "Contract draft not found."),
            ContractDraftFailure.Invalid => Problem(statusCode: 400, title: "Invalid draft data."),
            ContractDraftFailure.Conflict => Problem(statusCode: 409, title: "Draft is not ready for activation."),
            _ => throw new InvalidOperationException(),
        };
}

public sealed record ContractDraftCommentRequest(string Body);
