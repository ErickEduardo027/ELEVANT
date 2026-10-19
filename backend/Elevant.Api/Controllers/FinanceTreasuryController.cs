using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;
namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[ProducesResponseType<ProblemDetails>(400)]
[ProducesResponseType<ProblemDetails>(401)]
[ProducesResponseType<ProblemDetails>(403)]
[ProducesResponseType<ProblemDetails>(404)]
[ProducesResponseType<ProblemDetails>(409)]
[Route("api/v{version:apiVersion}/finance")]
public sealed class FinanceTreasuryController(IFinanceTreasuryStore treasury) : ControllerBase
{
    private bool Actor(out Guid actorId) => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId);
    private ActionResult<T> Error<T>(int status, string title)
    {
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
    private ActionResult<FinanceTreasuryMutationResponse> Result(FinanceTreasuryResult result)
    {
        if (result.Failure is { } failure)
        {
            var status = failure switch { FinanceTreasuryFailure.Invalid => 400, FinanceTreasuryFailure.Forbidden => 403,
                FinanceTreasuryFailure.NotFound => 404, _ => 409 };
            return Error<FinanceTreasuryMutationResponse>(status, failure.ToString());
        }
        return StatusCode(result.Replayed ? 200 : 201, new FinanceTreasuryMutationResponse(result.Id!.Value, result.Version!, result.Replayed));
    }
    [HttpGet("receipts/options", Name = "GetFinanceTreasuryOptions")]
    [ProducesResponseType<FinanceTreasuryOptionsResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryOptionsResponse>> Options(CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryOptionsResponse>(401, "Authentication failed.");
        var data = await treasury.OptionsAsync(actor, cancellationToken);
        return data is null ? Error<FinanceTreasuryOptionsResponse>(404, "Treasury scope was not found.") : Ok(FinanceTreasuryResponseMapper.Map(data));
    }
    [HttpGet("receipts", Name = "ListFinanceTreasuryReceipts")]
    [ProducesResponseType<FinanceTreasuryReceiptPageResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryReceiptPageResponse>> List([FromQuery] Guid? stationId, [FromQuery] Guid? airlineId,
        CancellationToken cancellationToken, [FromQuery] int page = 1, [FromQuery] int limit = 50)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryReceiptPageResponse>(401, "Authentication failed.");
        if (page is < 1 or > 1_000_000 || limit is < 1 or > 100) return Error<FinanceTreasuryReceiptPageResponse>(400, "Invalid page.");
        var data = await treasury.ListAsync(actor, stationId, airlineId, page, limit, cancellationToken);
        return data is null ? Error<FinanceTreasuryReceiptPageResponse>(404, "Receipts were not found.") : Ok(FinanceTreasuryResponseMapper.Map(data));
    }
    [HttpGet("receipts/{receiptId:guid}", Name = "GetFinanceTreasuryReceipt")]
    [ProducesResponseType<FinanceTreasuryReceiptResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryReceiptResponse>> Get(Guid receiptId, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryReceiptResponse>(401, "Authentication failed.");
        var data = await treasury.GetAsync(actor, receiptId, cancellationToken);
        return data is null ? Error<FinanceTreasuryReceiptResponse>(404, "Receipt was not found.") : Ok(FinanceTreasuryResponseMapper.Map(data));
    }
    [HttpPost("receipts", Name = "RecordFinanceTreasuryReceipt")]
    [RequestSizeLimit(65536)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(201)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryMutationResponse>> Record(FinanceTreasuryReceiptRequest request, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryMutationResponse>(401, "Authentication failed.");
        return Result(await treasury.RecordAsync(actor, FinanceTreasuryResponseMapper.Map(request), cancellationToken));
    }
    [HttpPost("receipts/{receiptId:guid}/applications", Name = "ApplyFinanceTreasuryReceipt")]
    [RequestSizeLimit(65536)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(201)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryMutationResponse>> Apply(Guid receiptId, FinanceTreasuryApplyRequest request, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryMutationResponse>(401, "Authentication failed.");
        return Result(await treasury.ApplyAsync(actor, receiptId, FinanceTreasuryResponseMapper.Map(request), cancellationToken));
    }
    [HttpPost("receipts/{receiptId:guid}/reversals", Name = "ReverseFinanceTreasuryReceipt")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(201)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryMutationResponse>> Reverse(Guid receiptId, FinanceTreasuryReverseRequest request, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryMutationResponse>(401, "Authentication failed.");
        return Result(await treasury.ReverseAsync(actor, receiptId, FinanceTreasuryResponseMapper.Map(request), cancellationToken));
    }
    [HttpPost("receipts/{receiptId:guid}/refunds", Name = "RefundFinanceTreasuryReceipt")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(201)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryMutationResponse>> Refund(Guid receiptId, FinanceTreasuryRefundRequest request, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryMutationResponse>(401, "Authentication failed.");
        return Result(await treasury.RefundAsync(actor, receiptId, FinanceTreasuryResponseMapper.Map(request), cancellationToken));
    }
    [HttpGet("invoices/{invoiceId:guid}/adjustment-notes", Name = "GetFinanceTreasuryAdjustments")]
    [ProducesResponseType<FinanceTreasuryAdjustmentsResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryAdjustmentsResponse>> Adjustments(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryAdjustmentsResponse>(401, "Authentication failed.");
        var data = await treasury.AdjustmentsAsync(actor, invoiceId, cancellationToken);
        return data is null ? Error<FinanceTreasuryAdjustmentsResponse>(404, "Invoice was not found.") : Ok(FinanceTreasuryResponseMapper.Map(data));
    }
    [HttpPost("invoices/{invoiceId:guid}/adjustment-notes", Name = "IssueFinanceTreasuryAdjustment")]
    [RequestSizeLimit(65536)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(201)]
    [ProducesResponseType<FinanceTreasuryMutationResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryMutationResponse>> IssueAdjustment(Guid invoiceId, FinanceTreasuryAdjustmentRequest request, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryMutationResponse>(401, "Authentication failed.");
        return Result(await treasury.IssueAdjustmentAsync(actor, invoiceId, FinanceTreasuryResponseMapper.Map(request), cancellationToken));
    }
    [HttpGet("statements", Name = "GetFinanceTreasuryStatement")]
    [ProducesResponseType<FinanceTreasuryStatementResponse>(200)]
    public async Task<ActionResult<FinanceTreasuryStatementResponse>> Statement([FromQuery] DateOnly asOf, [FromQuery] Guid? stationId,
        [FromQuery] Guid? airlineId, CancellationToken cancellationToken)
    {
        if (!Actor(out var actor)) return Error<FinanceTreasuryStatementResponse>(401, "Authentication failed.");
        var data = await treasury.StatementAsync(actor, asOf, stationId, airlineId, cancellationToken);
        return data is null ? Error<FinanceTreasuryStatementResponse>(404, "Statement was not found.") : Ok(FinanceTreasuryResponseMapper.Map(data));
    }
}
