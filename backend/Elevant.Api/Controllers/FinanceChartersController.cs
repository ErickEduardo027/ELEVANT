using System.Security.Claims;
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

    /// <summary>Confirms the prepayment; the same amount and reference again are a retry.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPut("{charterId:guid}/prepayment", Name = "ConfirmFinanceCharterPrepayment")]
    [Consumes("application/json")]
    [ProducesResponseType<FinanceCharterResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<FinanceCharterResponse>> ConfirmPrepayment([FromRoute] Guid charterId,
        [FromBody] ConfirmCharterPrepaymentRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure<FinanceCharterResponse>(OccReviewFailure.Unauthorized);
        var (item, failure) = await handler.ConfirmPrepaymentAsync(accountId, charterId, request.Amount, request.Reference,
            HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure<FinanceCharterResponse>(error) : Ok(Map(item!));
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

    /// <summary>A coded failure (the reopening, 3-N24) carries its code and a Spanish title; the others keep theirs.</summary>
    private ActionResult<T> Failure<T>(OccReviewFailure failure, string? code = null)
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
        if (code is null || failure is OccReviewFailure.Unauthorized or OccReviewFailure.Forbidden)
            problem.Title = title;
        else
        {
            problem.Title = code switch
            {
                "idempotency_key_required" => "No se pudo identificar el envío.",
                "idempotency_conflict" => "Ese envío ya se usó con otros datos.",
                "expected_version_required" => "Falta la versión del charter que se vio en pantalla.",
                "reason_required" => "Indique el motivo (entre 8 y 500 caracteres).",
                "not_found" => "El charter ya no existe o no está en su alcance.",
                CharterCodes.PrepaymentNotConfirmed => "El prepago no está confirmado.",
                _ => "El charter cambió mientras lo revisaba. Vuelva a cargarlo.",
            };
            problem.Extensions["code"] = code;
        }
        return new ObjectResult(problem) { StatusCode = status };
    }
}
