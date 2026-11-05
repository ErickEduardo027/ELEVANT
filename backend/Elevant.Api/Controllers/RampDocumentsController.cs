using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// AVIAM forms on the tablet (ADR-0032): the agent reads them, the signers sign them against the
/// exact content hash, and walk-around damages are marked on the silhouette with an optional photo.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampDocumentsController(OperationDocumentHandler handler) : ControllerBase
{
    private const long SignatureLimitBytes = 96 * 1024;
    private const long MarkLimitBytes = 4 * 1024;

    /// <summary>Forms of the operation with what each still needs signed.</summary>
    [HttpGet("{operationId:guid}/documents", Name = "GetRampOperationDocuments")]
    [ProducesResponseType<OperationDocumentsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OperationDocumentsResponse>> Get([FromRoute] Guid operationId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        var (data, failure) = await handler.ReadForAgentAsync(accountId, operationId, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(OperationDocumentResponseMapper.Map(data!));
    }

    /// <summary>Records a drawn signature on the form whose content hash the signer saw.</summary>
    [RequestSizeLimit(SignatureLimitBytes)]
    [HttpPut("{operationId:guid}/documents/{kind}/signatures/{role}", Name = "SignRampOperationDocument")]
    [Consumes("application/json")]
    [ProducesResponseType<OperationDocumentsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<OperationDocumentsResponse>> Sign(
        [FromRoute] Guid operationId,
        [FromRoute] string kind,
        [FromRoute] string role,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] SignOperationDocumentRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        if (!Enum.TryParse<OperationDocumentKind>(kind, false, out var documentKind) ||
            !Enum.TryParse<OperationSignatureRole>(role, false, out var signatureRole))
            return Failure(RampOperationsFailure.InvalidRequest);
        var (data, failure) = await handler.SignAsync(accountId, operationId, documentKind, signatureRole,
            request.SignerName, request.DocumentSha256, request.Strokes, DateTimeOffset.UtcNow, installationId,
            idempotencyKey, HttpContext.TraceIdentifier, cancellationToken, request.SignerIdentification);
        return failure is { } error ? Failure(error) : Ok(OperationDocumentResponseMapper.Map(data!));
    }

    /// <summary>Marks a damage found in the 360° walk-around; the id comes from the tablet.</summary>
    [RequestSizeLimit(MarkLimitBytes)]
    [HttpPut("{operationId:guid}/damage-marks/{markId:guid}", Name = "RecordRampDamageMark")]
    [Consumes("application/json")]
    [ProducesResponseType<OperationDocumentsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<OperationDocumentsResponse>> RecordDamageMark(
        [FromRoute] Guid operationId,
        [FromRoute] Guid markId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] RecordDamageMarkRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        var (data, failure) = await handler.RecordDamageMarkAsync(accountId, operationId, markId, request.X, request.Y,
            request.Note, request.ReportedAt, installationId, idempotencyKey, HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(OperationDocumentResponseMapper.Map(data!));
    }

    /// <summary>Attaches the photo of a marked damage: JPEG or PNG, one per mark; the same bytes again are a retry.</summary>
    [RequestSizeLimit(OperationDocumentRules.MaxPhotoBytes + 1024)]
    [HttpPut("{operationId:guid}/damage-marks/{markId:guid}/photo", Name = "AttachRampDamagePhoto")]
    [Consumes("image/jpeg", "image/png")]
    [ProducesResponseType<OperationDocumentsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable, "application/problem+json")]
    public async Task<ActionResult<OperationDocumentsResponse>> AttachDamagePhoto(
        [FromRoute] Guid operationId,
        [FromRoute] Guid markId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        using var buffer = new MemoryStream();
        await Request.Body.CopyToAsync(buffer, cancellationToken);
        if (buffer.Length > OperationDocumentRules.MaxPhotoBytes) return Failure(RampOperationsFailure.InvalidRequest);
        try
        {
            var (data, failure) = await handler.AttachDamagePhotoAsync(accountId, operationId, markId, buffer.ToArray(),
                installationId, HttpContext.TraceIdentifier, cancellationToken);
            return failure is { } error ? Failure(error) : Ok(OperationDocumentResponseMapper.Map(data!));
        }
        catch (OperationalEvidenceUnavailableException)
        {
            return Problem(StatusCodes.Status503ServiceUnavailable, "Walk-around photo storage is unavailable.");
        }
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<OperationDocumentsResponse> Failure(RampOperationsFailure failure)
    {
        if (failure == RampOperationsFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        var (status, title) = failure switch
        {
            RampOperationsFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            RampOperationsFailure.Forbidden => (StatusCodes.Status403Forbidden, "Access to the ramp operation is forbidden."),
            RampOperationsFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The form entry is invalid."),
            RampOperationsFailure.NotFound => (StatusCodes.Status404NotFound, "The ramp operation was not found."),
            _ => (StatusCodes.Status409Conflict, "The form changed or the entry conflicts with the operation; read it again."),
        };
        return Problem(status, title);
    }

    private ObjectResult Problem(int status, string title) =>
        new(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path }) { StatusCode = status };
}
