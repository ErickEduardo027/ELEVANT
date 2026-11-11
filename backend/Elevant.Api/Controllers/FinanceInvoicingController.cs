using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// «Por facturar» (phase 4, block A): the pending operations of a station with the limits of one invoice (4-N06,
/// 4-N16, 4-N18), and the closure without charge of operations whose valuation is zero (4-N07).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[InvoicingProblemDetails]
[Route("api/v{version:apiVersion}/finance/invoicing")]
public sealed class FinanceInvoicingController : ControllerBase
{
    private const long ClosureBodyLimitBytes = 16 * 1024;

    /// <summary>
    /// The station's operations approved by OCC that are not invoiced nor closed without charge, from the oldest to the
    /// newest. <c>from</c>, <c>to</c> and <c>airlineId</c> are optional filters; <c>cursor</c> is the
    /// <c>nextCursor</c> of the previous page and <c>limit</c> takes 1 to 100 (50 by default). Each operation carries
    /// its version, its estimated invoice lines and every code that blocks it.
    /// </summary>
    [HttpGet("pending-operations", Name = "GetFinancePendingOperations")]
    [ProducesResponseType<FinancePendingOperationsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<FinancePendingOperationsResponse>> PendingOperations(
        [FromServices] GetFinancePendingOperationsHandler handler, [FromQuery] Guid? stationId, [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to, [FromQuery] Guid? airlineId, [FromQuery] string? cursor, [FromQuery] int? limit,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return InvoicingProblems.Coded(this, StatusCodes.Status401Unauthorized, "Authentication failed.", null);
        if (stationId is null)
            return InvoicingProblems.Coded(this, StatusCodes.Status400BadRequest, "The pending query is invalid.",
                InvoicingCodes.InvalidPendingQuery);
        var result = await handler.HandleAsync(new GetFinancePendingOperationsQuery(accountId, stationId.Value, from, to,
            airlineId, cursor, limit ?? GetFinancePendingOperationsHandler.DefaultLimit), cancellationToken);
        if (!result.IsSuccess)
            return result.Failure switch
            {
                FinancePendingOperationsFailure.Unauthorized => InvoicingProblems.Coded(this,
                    StatusCodes.Status401Unauthorized, "Authentication failed.", null),
                FinancePendingOperationsFailure.Forbidden => InvoicingProblems.Coded(this,
                    StatusCodes.Status403Forbidden, "Invoicing is forbidden.", InvoicingCodes.Forbidden),
                FinancePendingOperationsFailure.InvalidRequest => InvoicingProblems.Coded(this,
                    StatusCodes.Status400BadRequest, "The pending query is invalid.", InvoicingCodes.InvalidPendingQuery),
                _ => InvoicingProblems.Coded(this, StatusCodes.Status404NotFound, "The station was not found.",
                    InvoicingCodes.NotFound),
            };
        var data = result.Data!;
        return Ok(new FinancePendingOperationsResponse(data.StationId,
            new FinanceInvoicingLimitsResponse(FinanceInvoicePolicy.MaxOperations, FinanceInvoicePolicy.MaxLines,
                FinanceInvoicePolicy.MaxDays),
            data.Airlines.Select(item => new FinancePendingAirlineResponse(item.AirlineId, item.AirlineName,
                item.PendingCount)).ToArray(),
            data.Operations.Select(item => new FinancePendingOperationResponse(item.OperationId, item.Version,
                item.OperationCode, item.OperationDate, item.AirlineId, item.AirlineName, item.FlightNumber,
                item.ContractCode, item.CurrencyCode, item.ServiceCount, item.LineEstimate, item.EstimatedNet, item.Ready,
                item.BlockingReasons, item.Services.Select(service => new FinancePendingServiceResponse(service.ServiceId,
                    service.ServiceCode, service.ServiceName, service.Ready, service.BlockingReason, service.Amount,
                    service.ChargeCount)).ToArray())).ToArray(),
            data.NextCursor, data.TotalPending));
    }

    /// <summary>
    /// 4-N07: closes operations whose valuation is zero without an invoice (no e-NCF, no email), with a reason of 5 to
    /// 500 characters and the version of each operation. The Idempotency-Key replays the first closure (200); another
    /// body with it is 409 <c>idempotency_conflict</c>. Operations with an amount are 422 <c>operation_has_charge</c>:
    /// they are invoiced. There is no reversal, like an issued invoice.
    /// </summary>
    [RequestSizeLimit(ClosureBodyLimitBytes)]
    [HttpPost("no-charge-closures", Name = "CloseOperationsWithoutCharge")]
    [Consumes("application/json")]
    [ProducesResponseType<NoChargeClosureResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<NoChargeClosureResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status422UnprocessableEntity, "application/problem+json")]
    public async Task<ActionResult<NoChargeClosureResponse>> CloseWithoutCharge(
        [FromServices] CloseOperationsWithoutChargeHandler handler,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] CloseOperationsWithoutChargeRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return InvoicingProblems.Coded(this, StatusCodes.Status401Unauthorized, "Authentication failed.", null);
        var result = await handler.HandleAsync(new NoChargeClosureCommand(accountId, request.StationId,
            (request.Operations ?? []).Select(item => item is null ? null! : new InvoiceOperationVersion(item.OperationId,
                item.Version)).ToArray(), request.Reason ?? string.Empty, idempotencyKey), cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title, fallback) = InvoicingProblems.Of(result.Failure);
            return InvoicingProblems.Coded(this, status, title, status == StatusCodes.Status401Unauthorized
                ? null : result.Code ?? fallback);
        }
        var closure = result.Closure!;
        var response = new NoChargeClosureResponse(closure.ClosureId, closure.OperationIds, result.Replayed);
        return result.Replayed ? Ok(response) : StatusCode(StatusCodes.Status201Created, response);
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
