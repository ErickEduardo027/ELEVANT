using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Commercial;
using Elevant.Application.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Downloads only the authenticated airline's private financial PDFs.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/airline/portal")]
public sealed class AirlineFinancialDocumentsController(
    GetFinancialDocumentHandler documents,
    ILogger<AirlineFinancialDocumentsController> logger) : ControllerBase
{
    [HttpGet("preinvoices/{preinvoiceId:guid}/invoice/document",
        Name = "GetAirlineInvoiceDocument")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<IActionResult> GetInvoice(Guid preinvoiceId,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        try
        {
            var result = await documents.GetAirlineInvoiceAsync(accountId, preinvoiceId,
                cancellationToken);
            return result.IsSuccess ? Pdf(result.Document!) : AirlineProblem(result.Failure!.Value);
        }
        catch (FinancialDocumentUnavailableException exception)
        {
            FinancialDocumentDiagnosticLog.Unavailable(logger, exception);
            return ProblemResult(503, "Financial document is unavailable.");
        }
    }

    /// <summary>ADR-0035: the simulated e-CF invoice PDF, addressed by the invoice id.</summary>
    [HttpGet("invoices/{invoiceId:guid}/document", Name = "GetAirlineInvoiceDocumentById")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<IActionResult> GetInvoiceById(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        try
        {
            var result = await documents.GetAirlineInvoiceByIdAsync(accountId, invoiceId, cancellationToken);
            return result.IsSuccess ? Pdf(result.Document!) : AirlineProblem(result.Failure!.Value);
        }
        catch (FinancialDocumentUnavailableException exception)
        {
            FinancialDocumentDiagnosticLog.Unavailable(logger, exception);
            return ProblemResult(503, "Financial document is unavailable.");
        }
    }

    [HttpGet("invoices/{invoiceId:guid}/receipt", Name = "GetAirlinePaymentReceipt")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<IActionResult> GetReceipt(Guid invoiceId,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        try
        {
            var result = await documents.GetAirlineReceiptAsync(accountId, invoiceId,
                cancellationToken);
            return result.IsSuccess ? Pdf(result.Document!) : AirlineProblem(result.Failure!.Value);
        }
        catch (FinancialDocumentUnavailableException exception)
        {
            FinancialDocumentDiagnosticLog.Unavailable(logger, exception);
            return ProblemResult(503, "Financial document is unavailable.");
        }
    }

    private bool TryAccountId(out Guid accountId)
    {
        var valid = Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId);
        if (!valid) Response.Headers.WWWAuthenticate = "Bearer";
        return valid;
    }

    private ObjectResult AirlineProblem(AirlinePortalFailure failure) => failure switch
    {
        AirlinePortalFailure.Unauthorized => ProblemResult(401, "Authentication failed."),
        AirlinePortalFailure.Forbidden => ProblemResult(403, "Airline access is forbidden."),
        AirlinePortalFailure.NotFound => ProblemResult(404, "Financial document was not found."),
        _ => throw new InvalidOperationException("Unsupported airline document failure."),
    };

    private FileContentResult Pdf(FinancialDocumentData document)
    {
        Response.Headers["X-Content-SHA256"] = document.Sha256;
        return File(document.Content, "application/pdf", document.FileName);
    }

    private ObjectResult ProblemResult(int status, string title)
    {
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
        }) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
