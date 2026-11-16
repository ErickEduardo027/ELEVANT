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

/// <summary>Opens a fresh editable revision after OCC returns a ramp operation.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations/{operationId:guid}/correction")]
public sealed class RampOperationCorrectionsController(
    RampOperationCorrectionHandler handler) : ControllerBase
{
    [HttpPost(Name = "ReopenRampOperationCorrection")]
    [ProducesResponseType<RampOperationCorrectionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    public async Task<ActionResult<RampOperationCorrectionResponse>> Reopen(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId) ||
            accountId == Guid.Empty)
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(401, "Authentication failed.");
        }

        var result = await handler.ReopenAsync(
            accountId, operationId, installationId, idempotencyKey,
            HttpContext.TraceIdentifier, cancellationToken);
        if (!result.IsSuccess)
        {
            return result.Failure switch
            {
                RampOperationsFailure.Unauthorized => UnauthorizedResult(),
                RampOperationsFailure.Forbidden => ProblemResult(403, "Ramp correction is forbidden."),
                RampOperationsFailure.InvalidRequest => ProblemResult(400, "The correction request is invalid."),
                RampOperationsFailure.NotFound => ProblemResult(404, "The ramp operation was not found."),
                RampOperationsFailure.Conflict => ProblemResult(409, "The operation is not ready for correction."),
                _ => throw new InvalidOperationException("Unsupported ramp correction failure."),
            };
        }

        var correction = result.Correction!;
        return Ok(new RampOperationCorrectionResponse(
            correction.ReceiptId, correction.OperationId,
            correction.PreviousSubmissionId, correction.ChecklistId,
            correction.RevisionNumber, correction.Status,
            correction.ReturnReason));
    }

    private ActionResult<RampOperationCorrectionResponse> UnauthorizedResult()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult(401, "Authentication failed.");
    }

    private ActionResult<RampOperationCorrectionResponse> ProblemResult(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status };
}
