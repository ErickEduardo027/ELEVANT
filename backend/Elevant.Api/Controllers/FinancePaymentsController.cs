using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// The legacy non-fiscal payment of an invoice: still readable for the history it keeps, but no longer written.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/payments")]
public sealed class FinancePaymentsController(GetNonFiscalPaymentHandler reader) : ControllerBase
{
    /// <summary>
    /// 4-N12: the legacy payment writer bypassed «Cobros y aplicaciones» and its permissions; it is retired. Payments
    /// are recorded and applied as treasury receipts (POST finance/receipts).
    /// </summary>
    [HttpPost(Name = "RecordNonFiscalPayment")]
    [RequestSizeLimit(1024)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone, "application/problem+json")]
    public IActionResult Record() =>
        FinanceResults.LegacyRetired(this, "Esta vía se retiró: registre los cobros en «Cobros y aplicaciones».");

    [HttpGet("by-invoice/{invoiceId:guid}", Name = "GetFinancePaymentByInvoice")]
    [ProducesResponseType<NonFiscalPaymentLookupResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<NonFiscalPaymentLookupResponse>> GetByInvoice(
        Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<NonFiscalPaymentLookupResponse>(401, "Authentication failed.");
        }
        var lookup = await reader.GetForFinanceAsync(accountId, invoiceId, cancellationToken);
        return lookup is null
            ? ProblemResult<NonFiscalPaymentLookupResponse>(404, "Invoice was not found.")
            : Ok(NonFiscalPaymentResponseMapper.Map(lookup));
    }

    private ActionResult<T> ProblemResult<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
}
