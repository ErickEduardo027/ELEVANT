using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.Hubs;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.SignalR;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Contratos' review of the public commercial requests. Commands take an Idempotency-Key and the
/// request rowversion the reviewer saw; every failure is Problem Details with a stable code.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/contracts/commercial-requests")]
public sealed class CommercialRequestsManagementController(
    ICommercialWorkflowStore store,
    IHubContext<PublicCatalogHub> publicCatalogHub,
    ILogger<CommercialRequestsManagementController> logger) : ControllerBase
{
    [HttpGet(Name = "ListCommercialRequests")]
    [ProducesResponseType<CommercialRequestData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var requests = await store.ListRequestsAsync(actorId, cancellationToken);
        return requests is null ? Forbid() : Ok(requests);
    }

    /// <summary>
    /// Inbox with server-side filter, search and paging, and the counters per status. By default it
    /// lists the open requests (pending and in review), oldest first.
    /// </summary>
    [HttpGet("inbox", Name = "ListCommercialRequestInbox")]
    [ProducesResponseType<CommercialInboxData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Inbox([FromQuery] string? status = null, [FromQuery] string? search = null,
        [FromQuery] int page = 1, [FromQuery] int limit = 25, CancellationToken cancellationToken = default)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var query = new CommercialInboxQuery(string.IsNullOrWhiteSpace(status) ? CommercialInboxQuery.Open : status.Trim(),
            string.IsNullOrWhiteSpace(search) ? null : search.Trim(), page, limit);
        if (!query.IsValid) return Coded(400, "El filtro de la bandeja no es válido.", "invalid_inbox_query");
        var inbox = await store.ListInboxAsync(actorId, query, cancellationToken);
        return inbox is null ? Forbid() : Ok(inbox);
    }

    [HttpGet("stations", Name = "ListCommercialStations")]
    [ProducesResponseType<CommercialStationData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Stations(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var stations = await store.ListStationsAsync(actorId, cancellationToken);
        return stations is null ? Forbid() : Ok(stations);
    }

    [HttpPut("airlines/{profileId:guid}/verification", Name = "VerifyCommercialAirline")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> VerifyAirline(Guid profileId,
        [FromBody] VerifyAirlineInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.VerifyAirlineAsync(actorId, profileId, input, cancellationToken);
        if (result.IsSuccess) await InvalidateCatalogAsync();
        return Respond(result);
    }

    /// <summary>
    /// Verifies the request's airline with an official source; the first verification moves the
    /// request to «En revisión». A proposed airline is linked to an existing profile or gets a new
    /// verified and published one.
    /// </summary>
    [HttpPost("{id:guid}/airline-verification", Name = "VerifyCommercialRequestAirline")]
    [RequestSizeLimit(16384)]
    [Consumes("application/json")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> VerifyRequestAirline(Guid id,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] VerifyRequestAirlineInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.VerifyRequestAirlineAsync(actorId, id, idempotencyKey, input, cancellationToken);
        if (result.IsSuccess) await InvalidateCatalogAsync();
        return Respond(result);
    }

    /// <summary>Records who confirmed the representative, when and how; approval requires it.</summary>
    [HttpPost("{id:guid}/representative-confirmation", Name = "ConfirmCommercialRepresentative")]
    [RequestSizeLimit(16384)]
    [Consumes("application/json")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> ConfirmRepresentative(Guid id,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] ConfirmCommercialRepresentativeInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.ConfirmRepresentativeAsync(actorId, id, idempotencyKey, input, cancellationToken));
    }

    /// <summary>Cancels a pending or in-review request with a reason; nothing is deleted.</summary>
    [HttpPost("{id:guid}/cancellation", Name = "CancelCommercialRequest")]
    [RequestSizeLimit(16384)]
    [Consumes("application/json")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Cancel(Guid id,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] CancelCommercialRequestInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.CancelAsync(actorId, id, idempotencyKey, input, cancellationToken));
    }

    /// <summary>
    /// Approves or rejects. The Idempotency-Key and <c>expectedVersion</c> are optional while older
    /// clients exist (expand); a key without the version is rejected. Approval returns the contract.
    /// </summary>
    [HttpPost("{id:guid}/decision", Name = "DecideCommercialRequest")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> Decide(Guid id, [FromBody] ReviewCommercialInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Respond(await store.DecideAsync(actorId, id, input, idempotencyKey, cancellationToken));
    }

    private Task InvalidateCatalogAsync() => PublicCatalogInvalidation.TrySendAsync(
        token => publicCatalogHub.Clients.All.SendAsync("CatalogChangedV1", token), logger);

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private IActionResult Respond(CommercialWorkflowResult result) => result.Failure is { } failure
        ? Failure(failure, result.Code)
        : Ok(new CommercialIdResponse(result.ResourceId!.Value));

    // Every failure carries a code; the clients explain the code, never the title.
    private IActionResult Failure(CommercialWorkflowFailure failure, string? code) => failure switch
    {
        CommercialWorkflowFailure.Forbidden => Forbid(),
        CommercialWorkflowFailure.NotFound => Coded(404, "La solicitud ya no existe.", code ?? "not_found"),
        CommercialWorkflowFailure.Invalid => Coded(400, "Los datos de la revisión no son válidos.",
            code ?? "invalid_commercial_request"),
        CommercialWorkflowFailure.Conflict => Coded(409, "La solicitud cambió o entra en conflicto con su estado actual.",
            code ?? "version_conflict"),
        CommercialWorkflowFailure.AirlineUnverified => Coded(409, "Verifique la aerolínea antes de aprobar.",
            code ?? "airline_unverified"),
        _ => throw new InvalidOperationException(),
    };

    private ObjectResult Coded(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
