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
/// Contract drafts (phase 1, block B): the airline reviews and comments its drafts; Contratos edits
/// terms, prices and scope, answers the airline, checks readiness, sends the draft to Finance or
/// discards it. New commands need an Idempotency-Key and the version rowversion; the commands that
/// already existed accept both as optional while older clients exist (expand). Every failure is
/// Problem Details with a stable code.
/// </summary>
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

    /// <summary>
    /// The airline comments its draft, also while Finance reviews it. The Idempotency-Key and
    /// <c>expectedVersion</c> are optional while older portals exist; a key without the version is rejected.
    /// </summary>
    [HttpPost("airline/contract-drafts/{versionId:guid}/comments", Name = "CommentAirlineContractDraft")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(8192)]
    public async Task<IActionResult> Comment(Guid versionId,
        [FromBody] ContractDraftCommentRequest input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.AddAirlineCommentAsync(actorId, versionId,
            new AirlineDraftCommentInput(input.Body, input.ExpectedVersion), idempotencyKey, cancellationToken);
        return Respond(result, StatusCodes.Status201Created);
    }

    [HttpGet("contracts/drafts", Name = "GetManagedContractDrafts")]
    [ProducesResponseType<ContractDraftData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ManagedDrafts(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var drafts = await store.ListForContractsAsync(actorId, cancellationToken);
        return drafts is null ? Forbid() : Ok(drafts);
    }

    [HttpGet("contracts/drafts/overview", Name = "GetManagedContractDraftOverview")]
    [ProducesResponseType<ContractDraftOverviewData>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ManagedDraftOverview(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var overview = await store.GetOverviewForContractsAsync(actorId, cancellationToken);
        return overview is null ? Forbid() : Ok(overview);
    }

    /// <summary>
    /// Saves terms, validity, currency, rates and charges. The Idempotency-Key and <c>expectedVersion</c>
    /// are optional while older clients exist (expand); a key without the version is rejected.
    /// </summary>
    [HttpPut("contracts/drafts/{versionId:guid}", Name = "UpdateManagedContractDraft")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> Update(Guid versionId,
        [FromBody] UpdateContractDraftInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.UpdateAsync(actorId, versionId, input, idempotencyKey, cancellationToken));
    }

    /// <summary>
    /// «Enviar a Finanzas» when every readiness rule holds; answers the contract. The body with
    /// <c>expectedVersion</c> and the Idempotency-Key are optional while older clients exist (expand).
    /// </summary>
    [HttpPost("contracts/drafts/{versionId:guid}/activate", Name = "ActivateManagedContractDraft")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> Activate(Guid versionId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] SubmitContractDraftInput? input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.ActivateAsync(actorId, versionId, input, idempotencyKey, cancellationToken));
    }

    /// <summary>Whether the draft can go to Finance, every blocking cause and the portal account status.</summary>
    [HttpGet("contracts/drafts/{versionId:guid}/readiness", Name = "GetManagedContractDraftReadiness")]
    [ProducesResponseType<ContractDraftReadinessData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Readiness(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetReadinessAsync(actorId, versionId, cancellationToken);
        return result.Data is { } data ? Ok(data) : Failure(result.Failure!.Value, null);
    }

    /// <summary>The services and stations of the draft and the active ones that can be added.</summary>
    [HttpGet("contracts/drafts/{versionId:guid}/scope", Name = "GetManagedContractDraftScope")]
    [ProducesResponseType<ContractDraftScopeData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Scope(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetScopeAsync(actorId, versionId, cancellationToken);
        return result.Data is { } data ? Ok(data) : Failure(result.Failure!.Value, null);
    }

    /// <summary>
    /// Sets the services and stations of a draft: kept services keep their rates, new ones start from
    /// the Finance base tariff unconfirmed, and only active catalog services can be added.
    /// </summary>
    [HttpPut("contracts/drafts/{versionId:guid}/scope", Name = "SetManagedContractDraftScope")]
    [Consumes("application/json")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> SetScope(Guid versionId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] SetContractDraftScopeInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.SetScopeAsync(actorId, versionId, idempotencyKey, input, cancellationToken));
    }

    /// <summary>
    /// Discards a draft or a version awaiting Finance with a reason. When it was the only live version of
    /// a contract that never activated, the contract is terminated too. Nothing is deleted.
    /// </summary>
    [HttpPost("contracts/drafts/{versionId:guid}/discard", Name = "DiscardManagedContractDraft")]
    [Consumes("application/json")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(8192)]
    public async Task<IActionResult> Discard(Guid versionId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] DiscardContractDraftInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.DiscardAsync(actorId, versionId, idempotencyKey, input, cancellationToken));
    }

    /// <summary>Contratos answers the airline on the draft; the answer appears in the portal.</summary>
    [HttpPost("contracts/drafts/{versionId:guid}/comments", Name = "ReplyManagedContractDraft")]
    [Consumes("application/json")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(8192)]
    public async Task<IActionResult> Reply(Guid versionId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] ReplyContractDraftInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.ReplyAsync(actorId, versionId, idempotencyKey, input, cancellationToken),
            StatusCodes.Status201Created);
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private IActionResult Respond(ContractDraftResult result, int successStatus = StatusCodes.Status200OK) =>
        result.Failure is { } failure
            ? Failure(failure, result.Code)
            : StatusCode(successStatus, new CommercialIdResponse(result.Id!.Value));

    // Every failure carries a code; the clients explain the code, never the title.
    private IActionResult Failure(ContractDraftFailure failure, string? code) => failure switch
    {
        ContractDraftFailure.Forbidden => Forbid(),
        ContractDraftFailure.NotFound => Coded(404, "El borrador ya no existe.", code ?? "not_found"),
        ContractDraftFailure.Invalid => Coded(400, "Los datos del borrador no son válidos.", code ?? "invalid_draft"),
        ContractDraftFailure.Conflict => Coded(409, "El borrador cambió o no admite esa acción en su estado actual.",
            code ?? "version_conflict"),
        _ => throw new InvalidOperationException(),
    };

    private ObjectResult Coded(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

/// <summary>An airline observation; <c>expectedVersion</c> is the draft rowversion the airline read.</summary>
public sealed record ContractDraftCommentRequest(string Body, string? ExpectedVersion = null);
