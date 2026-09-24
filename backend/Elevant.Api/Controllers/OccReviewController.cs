using System.Security.Claims;
using System.Text.RegularExpressions;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Station-scoped OCC review queue, evidence and guarded final decision.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/review")]
public sealed partial class OccReviewController(OccReviewHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 8 * 1024;

    [GeneratedRegex("^\"[0-9a-f]{64}\"$", RegexOptions.CultureInvariant)]
    private static partial Regex StrongTokenPattern();

    /// <summary>Returns the bounded latest-submission queue for one authorized station.</summary>
    [HttpGet("queue", Name = "GetOccReviewQueue")]
    [ProducesResponseType<OccReviewQueueResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<OccReviewQueueResponse>> GetQueue(
        [FromQuery, BindRequired] Guid stationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OccReviewQueueResponse>();
        var result = await handler.GetQueueAsync(accountId, stationId, cancellationToken);
        return result.IsSuccess
            ? Ok(new OccReviewQueueResponse(
                result.Queue!.StationId, result.Queue.StationCode, result.Queue.StationName,
                result.Queue.IanaTimeZone,
                result.Queue.Operations.Select(item => new OccReviewQueueItemResponse(
                    item.OperationId, item.SubmissionId, item.RevisionNumber, item.Status,
                    item.OperationCode, item.OperationDate, item.AirlineName, item.AgentName,
                    item.SubmittedAt, item.ServiceCount, item.IncidentCount)).ToArray(),
                result.Queue.HasMore))
            : FailureResult<OccReviewQueueResponse>(result.Failure!.Value);
    }

    /// <summary>Returns the latest submitted execution and its review evidence.</summary>
    [HttpGet("operations/{operationId:guid}", Name = "GetOccReviewDetail")]
    [ProducesResponseType<OccReviewDetailResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<OccReviewDetailResponse>> GetDetail(
        [FromRoute] Guid operationId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OccReviewDetailResponse>();
        var result = await handler.GetDetailAsync(accountId, operationId, cancellationToken);
        if (!result.IsSuccess) return FailureResult<OccReviewDetailResponse>(result.Failure!.Value);
        var detail = result.Detail!;
        Response.Headers.ETag = detail.ConcurrencyToken;
        return Ok(MapDetail(detail));
    }

    /// <summary>Lists immutable handoff revisions for one scoped operation, newest first.</summary>
    [HttpGet("operations/{operationId:guid}/submissions", Name = "GetOccReviewSubmissionHistory")]
    [ProducesResponseType<OccReviewSubmissionHistoryResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccReviewSubmissionHistoryResponse>> GetSubmissionHistory(
        [FromRoute] Guid operationId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId))
            return UnauthorizedResult<OccReviewSubmissionHistoryResponse>();
        var result = await handler.GetSubmissionHistoryAsync(
            accountId, operationId, cancellationToken);
        if (!result.IsSuccess)
            return FailureResult<OccReviewSubmissionHistoryResponse>(result.Failure!.Value);
        var history = result.History!;
        return Ok(new OccReviewSubmissionHistoryResponse(
            history.OperationId,
            history.Submissions.Select(item => new OccReviewSubmissionHistoryItemResponse(
                item.SubmissionId, item.RevisionNumber, item.Status,
                item.SubmittedAt, item.Outcome, item.DecidedAt)).ToArray(),
            history.HasMore));
    }

    /// <summary>Reads one immutable historical handoff, including its review decision.</summary>
    [HttpGet("operations/{operationId:guid}/submissions/{submissionId:guid}",
        Name = "GetOccReviewSubmissionDetail")]
    [ProducesResponseType<OccReviewDetailResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccReviewDetailResponse>> GetSubmissionDetail(
        [FromRoute] Guid operationId, [FromRoute] Guid submissionId,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OccReviewDetailResponse>();
        var result = await handler.GetSubmissionDetailAsync(
            accountId, operationId, submissionId, cancellationToken);
        if (!result.IsSuccess) return FailureResult<OccReviewDetailResponse>(result.Failure!.Value);
        return Ok(MapDetail(result.Detail!));
    }

    private static OccReviewDetailResponse MapDetail(OccReviewDetailData detail) =>
        new(
            detail.OperationId, detail.SubmissionId, detail.RevisionNumber, detail.Status,
            detail.OperationCode, detail.OperationDate, detail.StationId, detail.StationCode,
            detail.IanaTimeZone, detail.AirlineName, detail.AgentName,
            detail.PlannedStartAt, detail.PlannedEndAt, detail.ActualStartAt, detail.ActualEndAt,
            detail.SubmittedAt, detail.AgentNote, detail.ChecklistStatus,
            detail.ChecklistAnswers.Select(item => new OccReviewChecklistAnswerResponse(
                item.Section, item.Code, item.Label, item.Value, item.Note)).ToArray(),
            detail.Services.Select(item => new OccReviewServiceResponse(
                item.Id, item.Code, item.Name, item.Status, item.ContractedQuantity,
                item.ExecutedQuantity, item.Unit)).ToArray(),
            detail.Incidents.Select(item => new OccReviewIncidentResponse(
                item.Id, item.Type, item.Severity, item.Status, item.Description,
                item.OccurredAt)).ToArray(),
            detail.Decision is null ? null : new OccReviewDecisionResponse(
                detail.Decision.Outcome, detail.Decision.Reason, detail.Decision.DecidedAt),
            detail.ConcurrencyToken);

    /// <summary>Approves or returns one pending submission using its strong snapshot token.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("operations/{operationId:guid}/decision", Name = "DecideOccReview")]
    [Consumes("application/json")]
    [ProducesResponseType<DecideOccReviewResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<DecideOccReviewResponse>> Decide(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody, BindRequired] DecideOccReviewRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<DecideOccReviewResponse>();
        if (string.IsNullOrWhiteSpace(ifMatch))
            return ProblemResult<DecideOccReviewResponse>(428, "An If-Match precondition is required.");
        if (!StrongTokenPattern().IsMatch(ifMatch))
            return ProblemResult<DecideOccReviewResponse>(400, "The review precondition is invalid.");

        var result = await handler.DecideAsync(
            accountId, operationId, request.SubmissionId, ifMatch,
            request.Outcome, request.Reason, HttpContext.TraceIdentifier, cancellationToken);
        return result.IsSuccess
            ? Ok(new DecideOccReviewResponse(
                result.Decision!.OperationId, result.Decision.SubmissionId,
                result.Decision.Status, result.Decision.Outcome,
                result.Decision.DecidedAt, result.Decision.Reason))
            : FailureResult<DecideOccReviewResponse>(result.Failure!.Value);
    }

    private bool TryAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(401, "Authentication failed.");
    }

    private ActionResult<T> FailureResult<T>(OccReviewFailure failure) => failure switch
    {
        OccReviewFailure.Unauthorized => UnauthorizedResult<T>(),
        OccReviewFailure.Forbidden => ProblemResult<T>(403, "OCC review is forbidden."),
        OccReviewFailure.InvalidRequest => ProblemResult<T>(400, "The review request is invalid."),
        OccReviewFailure.NotFound => ProblemResult<T>(404, "The review resource was not found."),
        OccReviewFailure.Conflict => ProblemResult<T>(409, "The review state changed."),
        OccReviewFailure.PreconditionFailed => ProblemResult<T>(412, "The review snapshot changed."),
        _ => throw new InvalidOperationException("Unsupported OCC review failure."),
    };

    private ActionResult<T> ProblemResult<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status };
}
