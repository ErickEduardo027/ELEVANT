using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Application.Operations.TransitionRampOperationService;
using Elevant.Contracts.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Transitions assigned operation services for the authenticated ramp agent.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[RampProblemDetails]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampOperationServicesController(
    TransitionRampOperationServiceHandler handler) : ControllerBase
{
    private const long ServiceTransitionBodyLimitBytes = 8 * 1024;

    /// <summary>
    /// Applies one audited, idempotent service status transition. The optional <c>occurredAt</c> is the moment the
    /// agent tapped it (3-I): it must fit the operation's window and not precede the service's last transition (409
    /// <c>time_outside_operation_window</c>, <c>service_time_out_of_order</c>).
    /// </summary>
    [RequestSizeLimit(ServiceTransitionBodyLimitBytes)]
    [HttpPost(
        "{operationId:guid}/services/{serviceId:guid}/transition",
        Name = "TransitionRampOperationService")]
    [Consumes("application/json")]
    [ProducesResponseType<RampOperationServiceTransitionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<RampOperationServiceTransitionResponse>> Transition(
        [FromRoute] Guid operationId,
        [FromRoute] Guid serviceId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] TransitionRampOperationServiceRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return RampProblems.Failure(this, RampOperationsFailure.Unauthorized);
        }

        if (!Enum.TryParse<ServiceExecutionStatus>(
                request.TargetStatus,
                ignoreCase: false,
                out var targetStatus) ||
            !Enum.IsDefined(targetStatus))
        {
            return RampProblems.InvalidCommand(this);
        }

        var result = await handler.HandleAsync(
            new TransitionRampOperationServiceCommand(
                accountId,
                operationId,
                serviceId,
                targetStatus,
                request.ExecutedQuantity,
                request.Note,
                installationId,
                idempotencyKey,
                idempotencyKey,
                HttpContext.TraceIdentifier,
                request.OccurredAt),
            cancellationToken);
        if (!result.IsSuccess)
        {
            return RampProblems.Failure(this, result.Failure!.Value, result.Code);
        }

        var transition = result.Transition!;
        return Ok(new RampOperationServiceTransitionResponse(
            transition.ReceiptId,
            new RampOperationServiceExecutionResponse(
                transition.Service.Id,
                transition.Service.Status,
                transition.Service.ContractedQuantity,
                transition.Service.ExecutedQuantity,
                transition.Service.BillingUnit)));
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

}
