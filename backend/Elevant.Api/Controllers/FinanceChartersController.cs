using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Finance follows charter flights, confirms the carrier's prepayment (ADR-0033) and reopens a confirmed one as a new
/// quotation (3-N24).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/charters")]
public sealed class FinanceChartersController(CharterHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 2 * 1024;

    [HttpGet(Name = "GetFinanceCharters")]
    [ProducesResponseType<FinanceCharterListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<FinanceCharterListResponse>> List(CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceCharterListResponse>(OccReviewFailure.Unauthorized);
        var (items, failure) = await handler.ListForFinanceAsync(accountId, cancellationToken);
        return failure is { } error
            ? Failure<FinanceCharterListResponse>(error)
            : Ok(new FinanceCharterListResponse(items!.Select(Map).ToArray()));
    }

    /// <summary>
    /// 4-N22: confirms the prepayment with an Idempotency-Key and the version Finance saw (a stale one is 409
    /// <c>version_conflict</c>). Confirmed after the charter was invoiced, it settles that invoice at once and the excess
    /// stays as the airline's credit. The same amount and reference again change nothing; another amount or reference
    /// corrects it with a reason while it was never applied, else 409 <c>charter_prepayment_applied</c>. A receipt of the
    /// airline posted at the same moment is 409 <c>charter_prepayment_receipt_conflict</c>: nothing was written. Every
    /// refusal but a 401 carries its code.
    /// </summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [CharterCommandProblemDetails]
    [HttpPut("{charterId:guid}/prepayment", Name = "ConfirmFinanceCharterPrepayment")]
    [Consumes("application/json")]
    [ProducesResponseType<FinanceCharterResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<FinanceCharterResponse>> ConfirmPrepayment([FromRoute] Guid charterId,
        [FromBody] ConfirmCharterPrepaymentRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceCharterResponse>(OccReviewFailure.Unauthorized);
        var (item, failure, code) = await handler.ConfirmPrepaymentAsync(accountId, charterId, request.Amount,
            request.Reference, request.Reason, request.Version, idempotencyKey, HttpContext.TraceIdentifier,
            cancellationToken);
        return failure is { } error
            ? Failure<FinanceCharterResponse>(error, code ?? error switch
            {
                OccReviewFailure.Forbidden => "forbidden",
                OccReviewFailure.InvalidRequest => CharterCodes.InvalidRequest,
                OccReviewFailure.NotFound => "not_found",
                _ => "version_conflict",
            }, CorrectionReasonTitle)
            : Ok(Map(item!));
    }

    /// <summary>
    /// 3-N24: reopens a confirmed prepayment as a new quotation, so the agent can add services again; the amount and the
    /// reference stay until Finance confirms it again. Takes an Idempotency-Key and the version Finance saw (a stale one
    /// is 409 <c>version_conflict</c>); a prepayment not confirmed is 409 <c>charter_prepayment_not_confirmed</c>.
    /// </summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("{charterId:guid}/prepayment/reopening", Name = "ReopenFinanceCharterPrepayment")]
    [Consumes("application/json")]
    [ProducesResponseType<FinanceCharterResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<FinanceCharterResponse>> ReopenPrepayment([FromRoute] Guid charterId,
        [FromBody, BindRequired] ReopenCharterPrepaymentRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceCharterResponse>(OccReviewFailure.Unauthorized);
        var (item, failure, code) = await handler.ReopenPrepaymentAsync(accountId, charterId, request.Reason,
            request.Version, idempotencyKey, HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure<FinanceCharterResponse>(error, code) : Ok(Map(item!));
    }

    private static FinanceCharterResponse Map(CharterPrepaymentItem item) => new(item.Id, item.OperationId,
        item.OperationCode, item.OperationDate, item.StationCode, item.AirlineName, item.CurrencyCode, item.ServicesTotal,
        item.RequestSigned, item.PrepaymentStatus, item.PrepaymentAmount, item.PrepaymentReference, item.PrepaymentConfirmedAt,
        item.Version);

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private const string CorrectionReasonTitle = "Indique el motivo de la corrección (entre 5 y 500 caracteres).";

    /// <summary>
    /// A coded failure (the reopening, 3-N24, and the confirmation, 4-N22) carries its code and a Spanish title; the others
    /// keep theirs. A 403 of the confirmation carries <c>forbidden</c>; a 401 never carries a code.
    /// </summary>
    private ActionResult<T> Failure<T>(OccReviewFailure failure, string? code = null, string? reasonTitle = null)
    {
        if (failure == OccReviewFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        var (status, title) = failure switch
        {
            OccReviewFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            OccReviewFailure.Forbidden => (StatusCodes.Status403Forbidden, "Access to charters is forbidden."),
            OccReviewFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The prepayment is invalid."),
            OccReviewFailure.NotFound => (StatusCodes.Status404NotFound, "The charter was not found."),
            _ => (StatusCodes.Status409Conflict, "The charter already has another confirmed prepayment."),
        };
        var problem = new ProblemDetails { Status = status, Instance = HttpContext.Request.Path };
        if (code is null || failure is OccReviewFailure.Unauthorized)
            problem.Title = title;
        else if (failure is OccReviewFailure.Forbidden)
        {
            problem.Title = title;
            problem.Extensions["code"] = code;
        }
        else
        {
            problem.Title = code switch
            {
                "idempotency_key_required" => "No se pudo identificar el envío.",
                "idempotency_conflict" => "Ese envío ya se usó con otros datos.",
                "expected_version_required" => "Falta la versión del charter que se vio en pantalla.",
                "reason_required" => reasonTitle ?? "Indique el motivo (entre 8 y 500 caracteres).",
                "not_found" => "El charter ya no existe o no está en su alcance.",
                CharterCodes.PrepaymentNotConfirmed => "El prepago no está confirmado.",
                CharterCodes.PrepaymentApplied => "El prepago ya se aplicó a la factura del charter.",
                CharterCodes.PrepaymentReceiptConflict =>
                    "Otro cobro de la aerolínea se registró al mismo tiempo. Vuelva a cargar el charter.",
                CharterCodes.InvalidRequest => "Revise el monto y la referencia del prepago.",
                _ => "El charter cambió mientras lo revisaba. Vuelva a cargarlo.",
            };
            problem.Extensions["code"] = code;
        }
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

/// <summary>
/// 4-N22: answers a model-binding failure of the prepayment confirmation (a malformed Idempotency-Key, malformed JSON, an
/// amount or a reference out of range) with a coded 400 instead of the uncoded validation problem of the framework. It
/// runs before the <c>[ApiController]</c> model-state filter (order −2000), so that filter never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
internal sealed class CharterCommandProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.ModelState.IsValid || context.Controller is not ControllerBase controller) return;
        var keyFailed = context.ModelState.Any(entry => entry.Value?.Errors.Count > 0 &&
            (string.Equals(entry.Key, "Idempotency-Key", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(entry.Key, "idempotencyKey", StringComparison.OrdinalIgnoreCase)));
        var code = keyFailed ? "idempotency_key_required" : CharterCodes.InvalidRequest;
        var problem = new ProblemDetails
        {
            Status = StatusCodes.Status400BadRequest, Instance = controller.HttpContext.Request.Path,
            Title = keyFailed ? "No se pudo identificar el envío." : "Revise el monto y la referencia del prepago.",
        };
        problem.Extensions["code"] = code;
        context.Result = new ObjectResult(problem)
        {
            StatusCode = StatusCodes.Status400BadRequest, ContentTypes = { "application/problem+json" },
        };
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
