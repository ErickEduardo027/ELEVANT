using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Non-fiscal invoices with balances, payments and credit notes.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/invoices")]
public sealed class FinanceInvoiceLedgerController(IFinanceInvoiceLedgerStore store) : ControllerBase
{
    [HttpGet(Name = "ListFinanceInvoices")]
    [ProducesResponseType<FinanceInvoicePageData>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] Guid? stationId, [FromQuery] Guid? airlineId,
        [FromQuery] string? status, [FromQuery] int page = 1, [FromQuery] int limit = 25,
        CancellationToken cancellationToken = default)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ListAsync(actorId, stationId, airlineId, status, page, limit, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpGet("{invoiceId:guid}", Name = "GetFinanceInvoice")]
    [ProducesResponseType<FinanceInvoiceDetailData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Get(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.GetAsync(actorId, invoiceId, cancellationToken);
        return result is null ? Problem(statusCode: 404, title: "Invoice was not found.") : Ok(result);
    }

    [HttpPost("{invoiceId:guid}/credit-notes", Name = "IssueFinanceCreditNote")]
    [ProducesResponseType<FinanceIdResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(8192)]
    public async Task<IActionResult> IssueCreditNote(Guid invoiceId, [FromBody] IssueCreditNoteInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.IssueCreditNoteAsync(actorId, invoiceId, input, cancellationToken);
        return result.Failure switch
        {
            null => Ok(new FinanceIdResponse(result.Id!.Value)),
            FinanceCatalogFailure.Forbidden => Forbid(),
            FinanceCatalogFailure.NotFound => Problem(statusCode: 404, title: "Invoice was not found."),
            FinanceCatalogFailure.Invalid => Problem(statusCode: 400, title: "Invalid credit note."),
            _ => Problem(statusCode: 409, title: "The credit note exceeds the balance or was already issued."),
        };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
