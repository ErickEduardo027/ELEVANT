using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Contracts.Commercial;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Creates and reads non-fiscal drafts from OCC-approved service evidence.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/preinvoices")]
public sealed class PreinvoiceDraftsController(
    CreatePreinvoiceDraftHandler createHandler,
    GetPreinvoiceDraftHandler getHandler,
    SubmitPreinvoiceHandler submitHandler) : ControllerBase
{
    [HttpGet("{draftId:guid}/disputes", Name = "GetFinancePreinvoiceDisputes")]
    [ProducesResponseType<PreinvoiceDisputeListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<PreinvoiceDisputeListResponse>> GetDisputes(
        [FromRoute] Guid draftId, [FromQuery] bool includeResolutions,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId))
            return ProblemResult<PreinvoiceDisputeListResponse>(401, "Authentication failed.");
        var disputes = await getHandler.HandleDisputesAsync(accountId, draftId, cancellationToken);
        if (disputes is null)
            return ProblemResult<PreinvoiceDisputeListResponse>(404, "Preinvoice was not found.");
        return Ok(new PreinvoiceDisputeListResponse(draftId,
            disputes.Select(item => new PreinvoiceDisputeResponse(
                item.Id, item.Subject, item.Description, item.CreatedAt, item.LineIds,
                !includeResolutions || item.Resolution is null ? null : new PreinvoiceDisputeResolutionResponse(
                    item.Resolution.Id, item.Resolution.Decision,
                    item.Resolution.Reason, item.Resolution.ResolvedAt))).ToArray()));
    }

    [HttpPost("{draftId:guid}/submit", Name = "SubmitPreinvoice")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<SubmitPreinvoiceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<SubmitPreinvoiceResponse>> Submit(
        [FromRoute] Guid draftId, [FromBody] SubmitPreinvoiceRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId))
            return ProblemResult<SubmitPreinvoiceResponse>(401, "Authentication failed.");
        var result = await submitHandler.HandleAsync(
            new SubmitPreinvoiceCommand(accountId, draftId, request.RequestId), cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure!.Value switch
            {
                SubmitPreinvoiceFailure.Unauthorized => (401, "Authentication failed."),
                SubmitPreinvoiceFailure.Forbidden => (403, "Finance access is forbidden."),
                SubmitPreinvoiceFailure.InvalidRequest => (400, "Invalid submission request."),
                SubmitPreinvoiceFailure.NotFound => (404, "Preinvoice was not found."),
                SubmitPreinvoiceFailure.Conflict => (409, "Preinvoice state conflicts with submission."),
                _ => throw new InvalidOperationException("Unsupported preinvoice failure."),
            };
            return ProblemResult<SubmitPreinvoiceResponse>(status, title);
        }
        return Ok(new SubmitPreinvoiceResponse(result.PreinvoiceId!.Value,
            "Submitted", result.Replayed));
    }

    [HttpPost(Name = "CreatePreinvoiceDraft")]
    [RequestSizeLimit(8192)]
    [Consumes("application/json")]
    [ProducesResponseType<CreatePreinvoiceDraftResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<CreatePreinvoiceDraftResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status422UnprocessableEntity, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<CreatePreinvoiceDraftResponse>> Create(
        [FromBody] CreatePreinvoiceDraftRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId))
            return ProblemResult<CreatePreinvoiceDraftResponse>(401, "Authentication failed.");
        var result = await createHandler.HandleAsync(new CreatePreinvoiceDraftCommand(
            accountId, request.StationId, request.From, request.To,
            request.RequestId, request.ServiceIds), cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure!.Value switch
            {
                PreinvoiceDraftFailure.Unauthorized => (401, "Authentication failed."),
                PreinvoiceDraftFailure.Forbidden => (403, "Finance access is forbidden."),
                PreinvoiceDraftFailure.InvalidRequest => (400, "Invalid preinvoice selection."),
                PreinvoiceDraftFailure.NotFound => (404, "Approved service selection was not found."),
                PreinvoiceDraftFailure.Conflict => (409, "Service is already reserved or request key conflicts."),
                PreinvoiceDraftFailure.Unprocessable => (422, "Approved service cannot be billed."),
                _ => throw new InvalidOperationException("Unsupported preinvoice failure."),
            };
            return ProblemResult<CreatePreinvoiceDraftResponse>(status, title,
                result.Reason);
        }

        var response = new CreatePreinvoiceDraftResponse(result.DraftId!.Value, result.Replayed);
        return StatusCode(result.Replayed ? StatusCodes.Status200OK : StatusCodes.Status201Created,
            response);
    }

    [HttpGet("{draftId:guid}", Name = "GetPreinvoiceDraft")]
    [ProducesResponseType<PreinvoiceDraftResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<PreinvoiceDraftResponse>> Get(
        [FromRoute] Guid draftId, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId))
            return ProblemResult<PreinvoiceDraftResponse>(401, "Authentication failed.");
        var detail = await getHandler.HandleAsync(accountId, draftId, cancellationToken);
        if (detail is null)
            return ProblemResult<PreinvoiceDraftResponse>(404, "Preinvoice draft was not found.");
        return Ok(new PreinvoiceDraftResponse(detail.Id, detail.AirlineId,
            detail.AirlineName, detail.StationId, detail.From, detail.To,
            detail.CurrencyCode, detail.Total, detail.Status,
            detail.Lines.Select(line => new PreinvoiceDraftLineResponse(
                line.Id, line.OperationServiceId, line.ApprovedSubmissionId,
                line.LineNumber, line.OperationCode, line.OperationDate,
                line.ServiceCode, line.ServiceName, line.ExecutedQuantity,
                line.BillingUnit, line.UnitPrice, line.CurrencyCode, line.Amount)).ToArray()));
    }

    private bool TryAccount(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId);

    private ActionResult<T> ProblemResult<T>(int status, string title, string? code = null)
    {
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        var problem = new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
        };
        if (code is not null) problem.Extensions["code"] = code;
        return new ObjectResult(problem)
        { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
