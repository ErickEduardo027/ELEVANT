using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Hands a completed, assigned ramp operation to OCC for review.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations/{operationId:guid}/submit")]
public sealed class RampOperationSubmissionsController(
    RampOperationSubmissionHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 8 * 1024;

    /// <summary>Atomically closes execution and records an idempotent submission.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPost(Name = "SubmitRampOperation")]
    [Consumes("application/json")]
    [ProducesResponseType<RampOperationSubmissionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<RampOperationSubmissionResponse>> Submit(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] SubmitRampOperationRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId) ||
            accountId == Guid.Empty)
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await handler.SubmitAsync(
            accountId,
            operationId,
            installationId,
            idempotencyKey,
            request.AgentNote,
            HttpContext.TraceIdentifier,
            cancellationToken);
        if (!result.IsSuccess)
        {
            return result.Failure switch
            {
                RampOperationsFailure.Unauthorized => UnauthorizedSubmissionResult(),
                RampOperationsFailure.Forbidden => ProblemResult(403, "Ramp submission is forbidden."),
                RampOperationsFailure.InvalidRequest => ProblemResult(400, "The submission request is invalid."),
                RampOperationsFailure.NotFound => ProblemResult(404, "The ramp operation was not found."),
                RampOperationsFailure.Conflict => ProblemResult(409, "The operation is not ready for review."),
                _ => throw new InvalidOperationException("Unsupported ramp submission failure."),
            };
        }

        var submission = result.Submission!;
        return Ok(new RampOperationSubmissionResponse(
            submission.ReceiptId,
            submission.OperationId,
            submission.SubmissionId,
            submission.ChecklistId,
            submission.RevisionNumber,
            submission.Status,
            submission.SubmittedAt,
            submission.ActualEndAt,
            submission.AgentNote));
    }

    private ActionResult<RampOperationSubmissionResponse> UnauthorizedSubmissionResult()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult(401, "Authentication failed.");
    }

    private ActionResult<RampOperationSubmissionResponse> ProblemResult(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status };
}
