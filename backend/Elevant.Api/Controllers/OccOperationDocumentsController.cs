using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>OCC reads the AVIAM forms of an operation of its stations and downloads them as PDF (ADR-0032).</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/operations")]
public sealed class OccOperationDocumentsController(OperationDocumentHandler handler) : ControllerBase
{
    [HttpGet("{operationId:guid}/documents", Name = "GetOccOperationDocuments")]
    [ProducesResponseType<OperationDocumentsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OperationDocumentsResponse>> Get([FromRoute] Guid operationId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(OccReviewFailure.Unauthorized);
        var (data, failure) = await handler.ReadForOccAsync(accountId, operationId, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(OperationDocumentResponseMapper.Map(data!));
    }

    /// <summary>The current form as PDF, with its signatures and content hash.</summary>
    [HttpGet("{operationId:guid}/documents/{kind}/pdf", Name = "GetOccOperationDocumentPdf")]
    [Produces("application/pdf")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "application/pdf")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<IActionResult> GetPdf([FromRoute] Guid operationId, [FromRoute] string kind,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(OccReviewFailure.Unauthorized).Result!;
        if (!Enum.TryParse<OperationDocumentKind>(kind, false, out var documentKind))
            return Failure(OccReviewFailure.InvalidRequest).Result!;
        try
        {
            var (pdf, fileName, failure) = await handler.RenderForOccAsync(accountId, operationId, documentKind,
                cancellationToken);
            return failure is { } error ? Failure(error).Result! : File(pdf!, "application/pdf", fileName);
        }
        catch (OperationalEvidenceUnavailableException)
        {
            return Problem(StatusCodes.Status503ServiceUnavailable, "Walk-around photo storage is unavailable.");
        }
    }

    [HttpGet("{operationId:guid}/damage-marks/{markId:guid}/photo", Name = "GetOccDamagePhoto")]
    [Produces("image/jpeg", "image/png")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, "image/jpeg")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<IActionResult> GetDamagePhoto([FromRoute] Guid operationId, [FromRoute] Guid markId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(OccReviewFailure.Unauthorized).Result!;
        try
        {
            var (photo, failure) = await handler.ReadDamagePhotoForOccAsync(accountId, operationId, markId, cancellationToken);
            return failure is { } error ? Failure(error).Result! : File(photo!.Content, photo.ContentType);
        }
        catch (OperationalEvidenceUnavailableException)
        {
            return Problem(StatusCodes.Status503ServiceUnavailable, "Walk-around photo storage is unavailable.");
        }
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<OperationDocumentsResponse> Failure(OccReviewFailure failure)
    {
        if (failure == OccReviewFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        var (status, title) = failure switch
        {
            OccReviewFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            OccReviewFailure.Forbidden => (StatusCodes.Status403Forbidden, "Access to the operation forms is forbidden."),
            OccReviewFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The form request is invalid."),
            _ => (StatusCodes.Status404NotFound, "The operation or form was not found."),
        };
        return Problem(status, title);
    }

    private ObjectResult Problem(int status, string title) =>
        new(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path }) { StatusCode = status };
}
