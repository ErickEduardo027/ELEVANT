using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Issues a non-fiscal invoice only after airline acceptance.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/invoices")]
public sealed class FinanceInvoicesController(
    IssueFinanceInvoiceHandler handler, GetNonFiscalInvoiceHandler reader) : ControllerBase
{
    [HttpGet("by-preinvoice/{preinvoiceId:guid}", Name = "GetFinanceInvoiceByPreinvoice")]
    [ProducesResponseType<NonFiscalInvoiceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<NonFiscalInvoiceResponse>> GetByPreinvoice(
        Guid preinvoiceId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return new ObjectResult(new ProblemDetails
            {
                Status = 401, Title = "Authentication failed.",
                Instance = HttpContext.Request.Path,
            }) { StatusCode = 401, ContentTypes = { "application/problem+json" } };
        }
        var invoice = await reader.GetForFinanceAsync(accountId, preinvoiceId, cancellationToken);
        if (invoice is null)
            return new ObjectResult(new ProblemDetails
            {
                Status = 404, Title = "Invoice was not found.",
                Instance = HttpContext.Request.Path,
            }) { StatusCode = 404, ContentTypes = { "application/problem+json" } };
        return Ok(NonFiscalInvoiceResponseMapper.Map(invoice));
    }

    [HttpPost(Name = "IssueFinanceInvoice")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<IssueFinanceInvoiceResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<IssueFinanceInvoiceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<IssueFinanceInvoiceResponse>> Issue(
        [FromBody] IssueFinanceInvoiceRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(401, "Authentication failed.");
        }
        var result = await handler.HandleAsync(
            accountId, request.PreinvoiceId, request.RequestId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure!.Value switch
            {
                IssueFinanceInvoiceFailure.Unauthorized => (401, "Authentication failed."),
                IssueFinanceInvoiceFailure.Forbidden => (403, "Finance access is forbidden."),
                IssueFinanceInvoiceFailure.InvalidRequest => (400, "Invalid invoice request."),
                IssueFinanceInvoiceFailure.NotFound => (404, "Accepted preinvoice was not found."),
                IssueFinanceInvoiceFailure.Conflict => (409, "Preinvoice cannot be invoiced."),
                _ => throw new InvalidOperationException("Unsupported invoice failure."),
            };
            if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(status, title);
        }
        return StatusCode(result.Replayed ? 200 : 201,
            new IssueFinanceInvoiceResponse(result.InvoiceId!.Value,
                request.PreinvoiceId, result.Number!, "NonFiscal", result.Replayed));
    }

    private ActionResult<IssueFinanceInvoiceResponse> ProblemResult(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
}
