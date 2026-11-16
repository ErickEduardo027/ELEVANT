using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// ADR-0036: simulated card payment of the airline invoices, and its history for Finance. Phase 4, block C: every
/// refusal but a 401 carries a stable <c>code</c> (4-N05) next to the <c>reasons</c> older clients read.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[CardPaymentProblemDetails]
[Route("api/v{version:apiVersion}")]
public sealed class CardPaymentsController(PayInvoiceByCardHandler handler, ICardPaymentStore store,
    IFinancialDocumentPdfRenderer renderer, CardPaymentAvailabilityHandler availability) : ControllerBase
{
    private const long BodyLimitBytes = 2 * 1024;

    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("airline/portal/invoices/{invoiceId:guid}/card-payments", Name = "PayAirlineInvoiceByCard")]
    [Consumes("application/json")]
    [ProducesResponseType<CardPaymentResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<CardPaymentResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<CardPaymentResponse>> Pay(Guid invoiceId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody] PayInvoiceByCardBody body, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        var result = await handler.HandleAsync(new PayInvoiceByCardRequest(accountId, invoiceId, idempotencyKey,
            body.CardholderName, body.CardNumber, body.ExpiryMonth, body.ExpiryYear, body.SecurityCode, body.Amount),
            cancellationToken);
        if (!result.IsSuccess)
        {
            var reason = result.Reasons.Count > 0 ? result.Reasons[0] : null;
            var (status, title, code) = result.Failure switch
            {
                CardPaymentFailure.Unauthorized => (401, "Authentication failed.", (string?)null),
                CardPaymentFailure.Forbidden => (403, "Paying invoices is forbidden.", "forbidden"),
                CardPaymentFailure.NotFound => (404, "Invoice was not found.", "not_found"),
                // 4-N05: no card gateway in this environment; the portal hides the form.
                CardPaymentFailure.Unavailable => (409, "Card payments are not available.", CardPaymentCodes.Unavailable),
                // The conflict names its cause (invoice_paid, amount_mismatch, idempotency_conflict, concurrent_payment).
                CardPaymentFailure.Conflict => (409, "The invoice cannot be paid with this request.",
                    reason ?? CardPaymentCodes.Conflict),
                _ => (400, "The card payment request is invalid.",
                    reason == "idempotency_key_required" ? reason : CardPaymentCodes.Invalid),
            };
            return ProblemResult(status, title, result.Reasons, code);
        }
        var response = new CardPaymentResponse(Map(result.Attempt!), result.InvoiceBalance ?? 0, result.Replayed);
        return result.Replayed ? Ok(response) : StatusCode(StatusCodes.Status201Created, response);
    }

    /// <summary>
    /// 4-N05: whether this environment takes card payments and whether the gateway is the simulation. The portal hides
    /// the card form when it is unavailable; only an airline portal session reads it.
    /// </summary>
    [HttpGet("airline/portal/card-payments/availability", Name = "GetAirlineCardPaymentAvailability")]
    [ProducesResponseType<CardPaymentAvailabilityResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<ActionResult<CardPaymentAvailabilityResponse>> Availability(CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        var answer = await availability.HandleAsync(accountId, cancellationToken);
        return answer is null ? ProblemResult(403, "Card payments are for airline portal sessions.", code: "forbidden")
            : Ok(new CardPaymentAvailabilityResponse(answer.Available, answer.Simulated));
    }

    [HttpGet("airline/portal/invoices/{invoiceId:guid}/card-payments", Name = "GetAirlineInvoiceCardPayments")]
    [ProducesResponseType<CardPaymentListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<CardPaymentListResponse>> AirlineAttempts(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        var attempts = await store.AirlineAttemptsAsync(accountId, invoiceId, cancellationToken);
        return attempts is null ? ProblemResult(404, "Invoice was not found.", code: "not_found")
            : Ok(new CardPaymentListResponse(invoiceId, attempts.Select(Map).ToArray()));
    }

    [HttpGet("finance/invoices/{invoiceId:guid}/card-payments", Name = "GetFinanceInvoiceCardPayments")]
    [ProducesResponseType<CardPaymentListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<CardPaymentListResponse>> FinanceAttempts(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        var attempts = await store.FinanceAttemptsAsync(accountId, invoiceId, cancellationToken);
        return attempts is null ? ProblemResult(404, "Invoice was not found.", code: "not_found")
            : Ok(new CardPaymentListResponse(invoiceId, attempts.Select(Map).ToArray()));
    }

    [HttpGet("airline/portal/card-payments/{attemptId:guid}/receipt", Name = "GetAirlineCardPaymentReceipt")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Receipt(Guid attemptId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        var receipt = await store.AirlineReceiptAsync(accountId, attemptId, cancellationToken);
        return receipt is null ? ProblemResult(404, "Receipt was not found.", code: "not_found")
            : File(renderer.RenderCardReceipt(receipt), "application/pdf", $"recibo-{receipt.AuthorizationCode}.pdf");
    }

    private static CardPaymentAttemptResponse Map(CardPaymentAttemptData item) => new(item.Id, item.InvoiceId, item.Status,
        item.Brand, item.Last4, item.Amount, item.CurrencyCode, item.AuthorizationCode, item.DeclineCode, item.ReceiptId,
        item.AttemptedAt);

    private bool TryAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId);

    private ObjectResult ProblemResult(int status, string title, IReadOnlyList<string>? reasons = null, string? code = null) =>
        Problem(this, status, title, reasons, code);

    /// <summary>A card payment refusal; a 401 carries no code, like the other portal controllers.</summary>
    internal static ObjectResult Problem(ControllerBase controller, int status, string title, IReadOnlyList<string>? reasons,
        string? code)
    {
        if (status == 401) controller.Response.Headers.WWWAuthenticate = "Bearer";
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        if (status != 401 && code is not null) problem.Extensions["code"] = code;
        if (reasons is { Count: > 0 }) problem.Extensions["reasons"] = reasons;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}

/// <summary>
/// Answers the model-binding failures of the card payment (a missing or malformed Idempotency-Key, malformed JSON, an
/// unknown field, a value out of range) with a coded 400 instead of the uncoded validation problem of the framework.
/// It runs before the <c>[ApiController]</c> model-state filter (order -2000), so that filter never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class CardPaymentProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.ModelState.IsValid || context.Controller is not ControllerBase controller) return;
        var keyFailed = context.ModelState.Any(entry => entry.Value?.Errors.Count > 0 &&
            (string.Equals(entry.Key, "Idempotency-Key", StringComparison.OrdinalIgnoreCase) ||
             string.Equals(entry.Key, "idempotencyKey", StringComparison.OrdinalIgnoreCase)));
        context.Result = CardPaymentsController.Problem(controller, StatusCodes.Status400BadRequest,
            "The card payment request is invalid.", null, keyFailed ? "idempotency_key_required" : CardPaymentCodes.Invalid);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
