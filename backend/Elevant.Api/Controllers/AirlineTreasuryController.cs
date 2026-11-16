using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;
namespace Elevant.Api.Controllers;

/// <summary>Customer treasury reads. The store derives tenant and station coverage from current server memberships.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ProducesResponseType<ProblemDetails>(400)]
[ProducesResponseType<ProblemDetails>(401)]
[ProducesResponseType<ProblemDetails>(403)]
[ProducesResponseType<ProblemDetails>(404)]
[Route("api/v{version:apiVersion}/airline/portal/treasury")]
public sealed class AirlineTreasuryController(IFinanceTreasuryStore treasury, IFinancialDocumentPdfRenderer renderer)
    : ControllerBase
{
    private bool Actor(out Guid id) => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out id);
    /// <summary>Phase 4, block A: every refusal but a 401 carries the default code of its status.</summary>
    private ActionResult<T> Error<T>(int status)
    {
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        var problem = new ProblemDetails { Status = status, Instance = HttpContext.Request.Path,
            Title = status switch { 401 => "Authentication failed.", 403 => "Airline access is forbidden.",
                400 => "Invalid treasury query.", _ => "Document was not found." } };
        if (status != 401) problem.Extensions["code"] = FinanceTreasuryController.TreasuryCode(status);
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
    private ActionResult<TResponse> Read<TData, TResponse>(AirlineTreasuryReadResult<TData> result, Func<TData, TResponse> map) where TData : class
    {
        if (result.IsSuccess) return Ok(map(result.Data!));
        return Error<TResponse>(result.Failure switch { FinanceTreasuryFailure.Forbidden => 403, FinanceTreasuryFailure.Invalid => 400, _ => 404 });
    }
    [HttpGet("statements", Name = "GetAirlineTreasuryStatement")]
    [ProducesResponseType<AirlineTreasuryStatementResponse>(200)]
    public async Task<ActionResult<AirlineTreasuryStatementResponse>> Statement([FromQuery] DateOnly asOf,
        [FromQuery] Guid? stationId, CancellationToken cancellationToken)
    {
        if (!Actor(out var account)) return Error<AirlineTreasuryStatementResponse>(401);
        return Read<AirlineTreasuryStatementData, AirlineTreasuryStatementResponse>(
            await treasury.PortalStatementAsync(account, asOf, stationId, cancellationToken), AirlineTreasuryResponseMapper.Map);
    }
    [HttpGet("invoices/{invoiceId:guid}", Name = "GetAirlineTreasuryInvoice")]
    [ProducesResponseType<AirlineTreasuryInvoiceDetailResponse>(200)]
    public async Task<ActionResult<AirlineTreasuryInvoiceDetailResponse>> Invoice(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!Actor(out var account)) return Error<AirlineTreasuryInvoiceDetailResponse>(401);
        return Read<AirlineTreasuryInvoiceDetailData, AirlineTreasuryInvoiceDetailResponse>(
            await treasury.PortalInvoiceAsync(account, invoiceId, cancellationToken), AirlineTreasuryResponseMapper.Map);
    }
    [HttpGet("receipts/{receiptId:guid}", Name = "GetAirlineTreasuryReceipt")]
    [ProducesResponseType<AirlineTreasuryReceiptResponse>(200)]
    public async Task<ActionResult<AirlineTreasuryReceiptResponse>> Receipt(Guid receiptId, CancellationToken cancellationToken)
    {
        if (!Actor(out var account)) return Error<AirlineTreasuryReceiptResponse>(401);
        return Read<AirlineTreasuryReceiptData, AirlineTreasuryReceiptResponse>(
            await treasury.PortalReceiptAsync(account, receiptId, cancellationToken), AirlineTreasuryResponseMapper.Map);
    }
    /// <summary>
    /// 4-N17: the PDF of a credit or debit note of the airline's own invoice, within the portal's scope: the e-NCF
    /// E34/E33 and its frozen ITBIS, «Simulación — sin validez fiscal». Another airline's note is 404.
    /// </summary>
    [HttpGet("~/api/v{version:apiVersion}/airline/portal/adjustment-notes/{noteId:guid}/document",
        Name = "GetAirlineAdjustmentNoteDocument")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> AdjustmentNoteDocument(Guid noteId, CancellationToken cancellationToken)
    {
        if (!Actor(out var account)) return Error<object>(401).Result!;
        var result = await treasury.PortalAdjustmentNoteDocumentAsync(account, noteId, cancellationToken);
        if (!result.IsSuccess)
            return Error<object>(result.Failure switch { FinanceTreasuryFailure.Forbidden => 403, _ => 404 }).Result!;
        return File(renderer.RenderAdjustmentNote(result.Data!), "application/pdf", $"nota-{result.Data!.Number}.pdf");
    }
    [HttpGet("invoices/{invoiceId:guid}/adjustment-notes", Name = "GetAirlineTreasuryAdjustmentNotes")]
    [ProducesResponseType<AirlineTreasuryAdjustmentsResponse>(200)]
    public async Task<ActionResult<AirlineTreasuryAdjustmentsResponse>> Adjustments(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!Actor(out var account)) return Error<AirlineTreasuryAdjustmentsResponse>(401);
        return Read<AirlineTreasuryAdjustmentsData, AirlineTreasuryAdjustmentsResponse>(
            await treasury.PortalAdjustmentsAsync(account, invoiceId, cancellationToken), AirlineTreasuryResponseMapper.Map);
    }
}
