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

/// <summary>
/// Station-scoped OCC review queue, evidence and guarded final decision. Every command checks the review version in
/// If-Match (missing: 428 <c>expected_version_required</c>; stale: 412 <c>version_conflict</c>) and takes an
/// Idempotency-Key (optional on the decision and the charge adjustments while older callers exist, required on the
/// billing exclusion and the reopening). Every failure but 401 and 403 carries a stable code and a Spanish title.
/// </summary>
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
                item.OccurredAt, item.DelayCode)).ToArray(),
            detail.Decision is null ? null : new OccReviewDecisionResponse(
                detail.Decision.Outcome, detail.Decision.Reason, detail.Decision.DecidedAt),
            detail.ConcurrencyToken,
            detail.Close is not { } close ? null : new OccReviewCloseResponse(
                close.Milestones.Select(item => new OccReviewMilestoneResponse(item.Code, item.ActualAt)).ToArray(),
                close.Charges.Select(item => new OccReviewChargeResponse(item.MarkId, item.ServiceId, item.ServiceCode,
                    item.ChargeId, item.Code, item.Name, item.Source, item.AppliedAt, item.Reason)).ToArray(),
                close.ChargeOptions.Select(item => new OccReviewChargeOptionResponse(item.ChargeId, item.Code, item.Name,
                    item.AppliesToAllServices, item.ServiceIds)).ToArray(),
                new OccReviewTimingResponse(close.Timing.GroundMinutes, close.Timing.AllowedGroundMinutes,
                    close.Timing.ArrivalDelayMinutes, close.Timing.AircraftCategory),
                close.CanAdjustCharges, close.DamageCount,
                (close.BillingExclusions ?? []).Select(item => new OccReviewBillingExclusionResponse(item.ServiceId,
                    item.Reason, item.ExcludedAt)).ToArray()),
            detail.ServiceOrderState,
            detail.Reopening is not { } reopening ? null : new OccReviewReopeningResponse(reopening.FromRevisionNumber,
                reopening.Reason, reopening.ReopenedAt, reopening.ReopenedBy));

    /// <summary>OCC adds a charge to a service of the operation it is reviewing (ADR-0034).</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("operations/{operationId:guid}/charges", Name = "AddOccReviewCharge")]
    [Consumes("application/json")]
    [ProducesResponseType<OccReviewChargeAdjustResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public Task<ActionResult<OccReviewChargeAdjustResponse>> AddCharge([FromRoute] Guid operationId,
        [FromHeader(Name = "If-Match")] string? ifMatch, [FromBody, BindRequired] AddOccReviewChargeRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        AdjustAsync(operationId, ifMatch, request.SubmissionId, request.ServiceId, request.ChargeId, null, request.Reason,
            idempotencyKey, cancellationToken);

    /// <summary>OCC removes a charge from the operation it is reviewing, whoever marked it (ADR-0034).</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("operations/{operationId:guid}/charges/{markId:guid}/removal", Name = "RemoveOccReviewCharge")]
    [Consumes("application/json")]
    [ProducesResponseType<OccReviewChargeAdjustResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public Task<ActionResult<OccReviewChargeAdjustResponse>> RemoveCharge([FromRoute] Guid operationId,
        [FromRoute] Guid markId, [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody, BindRequired] RemoveOccReviewChargeRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken) =>
        AdjustAsync(operationId, ifMatch, request.SubmissionId, null, null, markId, request.Reason, idempotencyKey,
            cancellationToken);

    private async Task<ActionResult<OccReviewChargeAdjustResponse>> AdjustAsync(Guid operationId, string? ifMatch,
        Guid submissionId, Guid? serviceId, Guid? chargeId, Guid? markId, string? reason, Guid? idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OccReviewChargeAdjustResponse>();
        if (PreconditionProblem<OccReviewChargeAdjustResponse>(ifMatch) is { } precondition) return precondition;
        var result = await handler.AdjustChargeAsync(accountId, operationId, submissionId, ifMatch, serviceId, chargeId,
            markId, reason, HttpContext.TraceIdentifier, idempotencyKey, cancellationToken);
        if (!result.IsSuccess) return FailureResult<OccReviewChargeAdjustResponse>(result.Failure!.Value, result.Code);
        Response.Headers.ETag = result.ConcurrencyToken;
        return Ok(new OccReviewChargeAdjustResponse(result.ConcurrencyToken!));
    }

    /// <summary>
    /// 3-N11: OCC excludes a service in exception with an executed quantity from billing, or includes it again, with
    /// a reason. Only while the hand-off is pending; a signed Service Order records it as OCC's correction (3-N02).
    /// </summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("operations/{operationId:guid}/services/{serviceId:guid}/billing-exclusion",
        Name = "SetOccReviewServiceBillingExclusion")]
    [Consumes("application/json")]
    [ProducesResponseType<OccReviewChargeAdjustResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccReviewChargeAdjustResponse>> SetServiceBillingExclusion([FromRoute] Guid operationId,
        [FromRoute] Guid serviceId, [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromBody, BindRequired] SetOccReviewServiceBillingExclusionRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OccReviewChargeAdjustResponse>();
        if (PreconditionProblem<OccReviewChargeAdjustResponse>(ifMatch) is { } precondition) return precondition;
        var result = await handler.SetServiceBillingExclusionAsync(accountId, operationId, serviceId, request.SubmissionId,
            ifMatch, request.Excluded, request.Reason, idempotencyKey, HttpContext.TraceIdentifier, cancellationToken);
        if (!result.IsSuccess) return FailureResult<OccReviewChargeAdjustResponse>(result.Failure!.Value, result.Code);
        Response.Headers.ETag = result.ConcurrencyToken;
        return Ok(new OccReviewChargeAdjustResponse(result.ConcurrencyToken!));
    }

    /// <summary>
    /// 3-H: OCC reopens an approval nothing was invoiced from yet as a new pending revision, with its reason; once
    /// anything is invoiced the correction is a credit note (409 <c>already_invoiced</c>). The agent and the stand the
    /// approval freed stay free, and the reopened revision is approved again in OCC, never returned to the ramp, so an
    /// approval whose Service Order is not signed as it stands is not reopened (409 <c>service_order_unsigned</c> or
    /// <c>service_order_stale</c>, 3-N02).
    /// </summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("operations/{operationId:guid}/reopening", Name = "ReopenOccReview")]
    [Consumes("application/json")]
    [ProducesResponseType<OccReviewReopenResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccReviewReopenResponse>> Reopen([FromRoute] Guid operationId,
        [FromHeader(Name = "If-Match")] string? ifMatch, [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromBody, BindRequired] ReopenOccReviewRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OccReviewReopenResponse>();
        if (PreconditionProblem<OccReviewReopenResponse>(ifMatch) is { } precondition) return precondition;
        var result = await handler.ReopenAsync(accountId, operationId, request.SubmissionId, ifMatch, request.Reason,
            idempotencyKey, HttpContext.TraceIdentifier, cancellationToken);
        if (!result.IsSuccess) return FailureResult<OccReviewReopenResponse>(result.Failure!.Value, result.Code);
        var data = result.Data!;
        Response.Headers.ETag = data.ReviewVersion;
        return Ok(new OccReviewReopenResponse(data.OperationId, data.SubmissionId, data.RevisionNumber, data.Status,
            data.ReviewVersion));
    }

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
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<DecideOccReviewResponse>();
        if (PreconditionProblem<DecideOccReviewResponse>(ifMatch) is { } precondition) return precondition;

        var result = await handler.DecideAsync(
            accountId, operationId, request.SubmissionId, ifMatch,
            request.Outcome, request.Reason, HttpContext.TraceIdentifier, idempotencyKey, cancellationToken);
        return result.IsSuccess
            ? Ok(new DecideOccReviewResponse(
                result.Decision!.OperationId, result.Decision.SubmissionId,
                result.Decision.Status, result.Decision.Outcome,
                result.Decision.DecidedAt, result.Decision.Reason))
            : FailureResult<DecideOccReviewResponse>(result.Failure!.Value, result.Code);
    }

    private bool TryAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(401, "Authentication failed.", null);
    }

    /// <summary>A missing If-Match is 428 <c>expected_version_required</c>; one that is not a strong ETag, 400.</summary>
    private ActionResult<T>? PreconditionProblem<T>(string? ifMatch)
    {
        if (string.IsNullOrWhiteSpace(ifMatch))
            return ProblemResult<T>(428, Title("expected_version_required"), "expected_version_required");
        return StrongTokenPattern().IsMatch(ifMatch)
            ? null
            : ProblemResult<T>(400, Title(OccReviewHandler.InvalidRequestCode), OccReviewHandler.InvalidRequestCode);
    }

    /// <summary>
    /// The Problem Details of a refused review command. A 403 keeps no code (the shell explains the permission); every
    /// other failure carries the store's code or, when it has none, the status's default.
    /// </summary>
    private ActionResult<T> FailureResult<T>(OccReviewFailure failure, string? code = null)
    {
        if (failure == OccReviewFailure.Unauthorized) return UnauthorizedResult<T>();
        if (failure == OccReviewFailure.Forbidden) return ProblemResult<T>(403, "No tiene permiso para esta revisión.", null);
        var (status, fallback) = failure switch
        {
            OccReviewFailure.InvalidRequest => (StatusCodes.Status400BadRequest, OccReviewHandler.InvalidRequestCode),
            OccReviewFailure.NotFound => (StatusCodes.Status404NotFound, "not_found"),
            OccReviewFailure.PreconditionFailed => (StatusCodes.Status412PreconditionFailed, "version_conflict"),
            OccReviewFailure.Conflict => (StatusCodes.Status409Conflict, "version_conflict"),
            _ => throw new InvalidOperationException("Unsupported OCC review failure."),
        };
        var resolved = code ?? fallback;
        return ProblemResult<T>(status, Title(resolved), resolved);
    }

    private static string Title(string code) => code switch
    {
        "expected_version_required" => "Falta la versión de la revisión que se vio en pantalla.",
        "invalid_review_request" => "La solicitud de revisión no es válida.",
        "idempotency_key_required" => "No se pudo identificar el envío.",
        "idempotency_conflict" => "Ese envío ya se usó con otros datos.",
        "reason_required" => "Indique el motivo.",
        "not_found" => "La operación ya no existe o no está en su alcance.",
        "version_conflict" => "La revisión cambió mientras la revisaba. Vuelva a cargarla.",
        "review_closed" => "La entrega ya no está pendiente de revisión.",
        "review_already_decided" => "La entrega ya tiene una decisión.",
        "review_not_approved" => "Solo se reabre una operación aprobada.",
        "reopened_review_cannot_return" => "Una revisión reabierta se corrige y aprueba en OCC: no vuelve a rampa.",
        "already_invoiced" => "Ya hay servicios facturados: corrija con una nota de crédito.",
        "service_order_unsigned" => "La Orden de Servicio no está firmada.",
        "service_order_stale" => "La Orden de Servicio cambió después de la firma.",
        "billing_exclusion_not_allowed" => "Solo se excluye un servicio con excepción y cantidad ejecutada.",
        "charge_excluded_by_contract" => "El contrato de la aerolínea excluye este cargo.",
        "charge_not_applicable" => "El cargo no aplica a este servicio.",
        "charge_already_marked" => "El servicio ya tiene este cargo.",
        "charge_already_removed" => "El cargo ya se quitó.",
        _ => "La revisión no admite este cambio.",
    };

    private ActionResult<T> ProblemResult<T>(int status, string title, string? code)
    {
        var problem = new ProblemDetails
        {
            Status = status,
            Title = title,
            Instance = HttpContext.Request.Path,
        };
        if (code is not null) problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
