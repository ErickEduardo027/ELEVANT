using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Downloads station-scoped private financial PDFs for Finance.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance")]
public sealed class FinanceFinancialDocumentsController(
    GetFinancialDocumentHandler documents,
    ILogger<FinanceFinancialDocumentsController> logger) : ControllerBase
{
    /// <summary>ADR-0035: the simulated e-CF invoice PDF, addressed by the invoice id.</summary>
    [HttpGet("invoices/{invoiceId:guid}/document", Name = "GetFinanceInvoiceDocumentById")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<IActionResult> GetInvoiceById(Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        try
        {
            var document = await documents.GetFinanceInvoiceByIdAsync(accountId, invoiceId, cancellationToken);
            return document is null ? ProblemResult(404, "Financial document was not found.") : Pdf(document);
        }
        catch (FinancialDocumentUnavailableException exception)
        {
            FinancialDocumentDiagnosticLog.Unavailable(logger, exception);
            return ProblemResult(503, "Financial document is unavailable.");
        }
    }

    [HttpGet("payments/by-invoice/{invoiceId:guid}/receipt",
        Name = "GetFinancePaymentReceipt")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<IActionResult> GetReceipt(Guid invoiceId,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return ProblemResult(401, "Authentication failed.");
        try
        {
            var document = await documents.GetFinanceReceiptAsync(accountId, invoiceId,
                cancellationToken);
            return document is null ? ProblemResult(404, "Financial document was not found.")
                : Pdf(document);
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
