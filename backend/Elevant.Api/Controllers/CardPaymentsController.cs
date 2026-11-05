using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>ADR-0036: simulated card payment of the airline invoices, and its history for Finance.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}")]
public sealed class CardPaymentsController(PayInvoiceByCardHandler handler, ICardPaymentStore store,
    IFinancialDocumentPdfRenderer renderer) : ControllerBase
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
            var (status, title) = result.Failure switch
            {
                CardPaymentFailure.Unauthorized => (401, "Authentication failed."),
                CardPaymentFailure.Forbidden => (403, "Paying invoices is forbidden."),
                CardPaymentFailure.NotFound => (404, "Invoice was not found."),
                CardPaymentFailure.Conflict => (409, "The invoice cannot be paid with this request."),
                _ => (400, "The card payment request is invalid."),
            };
            return ProblemResult(status, title, result.Reasons);
        }
        var response = new CardPaymentResponse(Map(result.Attempt!), result.InvoiceBalance ?? 0, result.Replayed);
        return result.Replayed ? Ok(response) : StatusCode(StatusCodes.Status201Created, response);
    }

    [HttpGet("airline/portal/invoices/{invoiceId:guid}/card-payments", Name = "GetAirlineInvoiceCardPayments")]
    [ProducesResponseType<CardPaymentListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<CardPaymentListResponse>> AirlineAttempts(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        var attempts = await store.AirlineAttemptsAsync(accountId, invoiceId, cancellationToken);
        return attempts is null ? ProblemResult(404, "Invoice was not found.")
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
        return attempts is null ? ProblemResult(404, "Invoice was not found.")
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
        return receipt is null ? ProblemResult(404, "Receipt was not found.")
            : File(renderer.RenderCardReceipt(receipt), "application/pdf", $"recibo-{receipt.AuthorizationCode}.pdf");
    }

    private static CardPaymentAttemptResponse Map(CardPaymentAttemptData item) => new(item.Id, item.InvoiceId, item.Status,
        item.Brand, item.Last4, item.Amount, item.CurrencyCode, item.AuthorizationCode, item.DeclineCode, item.ReceiptId,
        item.AttemptedAt);

    private bool TryAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId);

    private ObjectResult ProblemResult(int status, string title, IReadOnlyList<string>? reasons = null)
    {
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        if (reasons is { Count: > 0 }) problem.Extensions["reasons"] = reasons;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
