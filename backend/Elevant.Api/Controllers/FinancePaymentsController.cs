using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.HealthChecks;
using Elevant.Application.Finance;
using Elevant.Contracts.Finance;
using Elevant.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/payments")]
public sealed class FinancePaymentsController(
    RecordNonFiscalPaymentHandler writer, GetNonFiscalPaymentHandler reader,
    IConfiguration configuration) : ControllerBase
{
    [HttpPost(Name = "RecordNonFiscalPayment")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<RecordNonFiscalPaymentResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<RecordNonFiscalPaymentResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<RecordNonFiscalPaymentResponse>> Record(
        [FromBody] RecordNonFiscalPaymentRequest request,
        CancellationToken cancellationToken)
    {
        if (!IsDevelopmentTarget())
            return ProblemResult<RecordNonFiscalPaymentResponse>(404,
                "Manual payment recording is not available.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<RecordNonFiscalPaymentResponse>(401, "Authentication failed.");
        }
        var result = await writer.HandleAsync(accountId, request.InvoiceId,
            request.RequestId, request.Reference, cancellationToken);
        if (!result.IsSuccess)
        {
            var (status, title) = result.Failure!.Value switch
            {
                RecordNonFiscalPaymentFailure.Unauthorized => (401, "Authentication failed."),
                RecordNonFiscalPaymentFailure.Forbidden => (403, "Finance access is forbidden."),
                RecordNonFiscalPaymentFailure.InvalidRequest => (400, "Invalid payment request."),
                RecordNonFiscalPaymentFailure.NotFound => (404, "Invoice was not found."),
                RecordNonFiscalPaymentFailure.Conflict => (409, "Invoice cannot be paid."),
                _ => throw new InvalidOperationException("Unsupported payment failure."),
            };
            if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<RecordNonFiscalPaymentResponse>(status, title);
        }
        return StatusCode(result.Replayed ? 200 : 201,
            new RecordNonFiscalPaymentResponse(result.PaymentId!.Value,
                request.InvoiceId, result.Reference!, result.CurrencyCode!,
                result.Amount!.Value, result.Replayed));
    }

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

    private bool IsDevelopmentTarget()
    {
        try
        {
            var target = DatabaseRuntimeTarget.Resolve(
                configuration.GetConnectionString("ElevantDatabase") ?? string.Empty,
                configuration[DatabaseTargetGuard.EnvironmentVariable]);
            return target.EnvironmentName == "Development";
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }
}
