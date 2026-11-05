using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Finance issues invoices straight from completed operations, without a preinvoice (ADR-0035).</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/invoices")]
public sealed class FinanceInvoiceIssuanceController(IssueInvoiceHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 8 * 1024;

    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost("from-operations", Name = "IssueInvoiceFromOperations")]
    [Consumes("application/json")]
    [ProducesResponseType<IssuedInvoiceResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<IssuedInvoiceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status422UnprocessableEntity, "application/problem+json")]
    public async Task<ActionResult<IssuedInvoiceResponse>> Issue([FromBody] IssueInvoiceFromOperationsRequest request,
        CancellationToken cancellationToken)
    {
        var accountId = Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id) ? id : Guid.Empty;
        var result = await handler.HandleAsync(new IssueInvoiceRequest(accountId, request.StationId,
            request.OperationIds ?? [], request.RequestId), cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure switch
            {
                IssueInvoiceFailure.Unauthorized => (401, "Authentication failed."),
                IssueInvoiceFailure.Forbidden => (403, "Issuing invoices is forbidden."),
                IssueInvoiceFailure.InvalidRequest => (400, "The invoice request is invalid."),
                IssueInvoiceFailure.NotFound => (404, "An operation was not found in the station."),
                IssueInvoiceFailure.Conflict => (409, "An operation is not approved or was already invoiced."),
                _ => (422, "The operations cannot be invoiced together."),
            };
            if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
            var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
            if (result.Reason is { } reason) problem.Extensions["reasons"] = new[] { reason };
            return new ObjectResult(problem) { StatusCode = status };
        }
        var response = new IssuedInvoiceResponse(result.InvoiceId!.Value, result.Number!, result.FiscalNumber!,
            result.Total!.Value, result.CurrencyCode!, result.Replayed);
        return result.Replayed ? Ok(response) : StatusCode(StatusCodes.Status201Created, response);
    }
}
