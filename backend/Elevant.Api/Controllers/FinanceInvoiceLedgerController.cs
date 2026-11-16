using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>«Facturas»: the invoices with their balance, payments and adjustment notes.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/invoices")]
public sealed class FinanceInvoiceLedgerController(IFinanceInvoiceLedgerStore store) : ControllerBase
{
    /// <summary>Longest text «Facturas» searches by: an e-NCF or invoice number prefix, or part of the airline.</summary>
    public const int MaxSearchLength = 40;

    /// <summary>
    /// The invoices of the actor's stations, newest first (4-N21). <c>search</c> (1 to 40 characters once trimmed)
    /// matches the start of the e-NCF or of the internal number, or any part of the airline name; <c>page</c> starts at
    /// 1 and <c>limit</c> takes 1 to 100. An invalid query is 400 <c>invalid_invoice_query</c>.
    /// </summary>
    [HttpGet(Name = "ListFinanceInvoices")]
    [FinanceQueryProblem(FinanceResults.InvalidInvoiceQueryCode)]
    [ProducesResponseType<FinanceInvoicePageData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] Guid? stationId, [FromQuery] Guid? airlineId,
        [FromQuery] string? status, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int limit = 25,
        CancellationToken cancellationToken = default)
    {
        if (!TryActor(out var actorId)) return FinanceResults.Unauthorized(this);
        var text = string.IsNullOrWhiteSpace(search) ? null : search.Trim();
        if (page < 1 || limit is < 1 or > 100 || text is { Length: > MaxSearchLength })
            return FinanceResults.Coded(this, StatusCodes.Status400BadRequest, "The invoice query is invalid.",
                FinanceResults.InvalidInvoiceQueryCode);
        var result = await store.ListAsync(actorId, stationId, airlineId, status, page, limit, text, cancellationToken);
        return result is null ? FinanceResults.Forbidden(this, "Invoices are forbidden in this scope.") : Ok(result);
    }

    [HttpGet("{invoiceId:guid}", Name = "GetFinanceInvoice")]
    [ProducesResponseType<FinanceInvoiceDetailData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Get(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return FinanceResults.Unauthorized(this);
        var result = await store.GetAsync(actorId, invoiceId, cancellationToken);
        return result is null ? FinanceResults.NotFound(this, "Invoice was not found.") : Ok(result);
    }

    /// <summary>
    /// 4-N12: the legacy credit note bypassed «Notas de ajuste» and its permission; it is retired. Credit and debit
    /// notes are issued from the invoice's adjustment notes (POST finance/invoices/{id}/adjustment-notes).
    /// </summary>
    [HttpPost("{invoiceId:guid}/credit-notes", Name = "IssueFinanceCreditNote")]
    [RequestSizeLimit(8192)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status410Gone, "application/problem+json")]
    public IActionResult IssueCreditNote(Guid invoiceId) =>
        FinanceResults.LegacyRetired(this, "Esta vía se retiró: corrija la factura con sus notas de ajuste.");

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
