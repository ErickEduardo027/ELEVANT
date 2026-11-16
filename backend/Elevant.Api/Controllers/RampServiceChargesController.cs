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

/// <summary>Charges the authenticated ramp agent marks on the services of an assigned operation.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampServiceChargesController(RampServiceChargesHandler handler) : ControllerBase
{
    /// <summary>Charges the agent may mark on each service, and the ones already marked. Never includes prices.</summary>
    [HttpGet("{operationId:guid}/charges", Name = "GetRampOperationCharges")]
    [ProducesResponseType<RampOperationChargesResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<RampOperationChargesResponse>> Read([FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId)) return Failure<RampOperationChargesResponse>(RampOperationsFailure.Unauthorized);
        var result = await handler.ReadAsync(accountId, operationId, installationId, cancellationToken);
        if (!result.IsSuccess) return Failure<RampOperationChargesResponse>(result.Failure!.Value);
        return Ok(new RampOperationChargesResponse(result.Charges!.OperationId,
            result.Charges.Services.Select(Map).ToArray()));
    }

    /// <summary>Marks (Apply) or unmarks (Remove) one charge on a service; idempotent per device and key.</summary>
    [RequestSizeLimit(4096)]
    [HttpPost("{operationId:guid}/services/{serviceId:guid}/charges", Name = "ApplyRampServiceCharge")]
    [Consumes("application/json")]
    [ProducesResponseType<RampServiceChargeCommandResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<RampServiceChargeCommandResponse>> Apply([FromRoute] Guid operationId,
        [FromRoute] Guid serviceId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] ApplyRampServiceChargeRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var accountId))
            return Failure<RampServiceChargeCommandResponse>(RampOperationsFailure.Unauthorized);
        if (!Enum.TryParse<RampServiceChargeAction>(request.Action, false, out var action) || !Enum.IsDefined(action))
            return Failure<RampServiceChargeCommandResponse>(RampOperationsFailure.InvalidRequest);
        var result = await handler.HandleAsync(new RampServiceChargeCommand(accountId, operationId, serviceId,
            request.ChargeId, action, installationId, idempotencyKey, idempotencyKey, HttpContext.TraceIdentifier),
            cancellationToken);
        if (!result.IsSuccess) return Failure<RampServiceChargeCommandResponse>(result.Failure!.Value);
        return Ok(new RampServiceChargeCommandResponse(result.Command!.ReceiptId, Map(result.Command.Service)));
    }

    private static RampServiceChargesResponse Map(RampServiceChargesData service) =>
        new(service.ServiceId, service.CanEdit,
            service.Available.Select(option => new RampChargeOptionResponse(option.Id, option.Code, option.Name,
                option.Description, option.Category, option.AllowMultiple)).ToArray(),
            service.Applied.Select(mark => new RampAppliedChargeResponse(mark.Id, mark.ChargeId, mark.Code, mark.Name,
                mark.AppliedAt, mark.Source)).ToArray());

    private bool TryAccount(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<T> Failure<T>(RampOperationsFailure failure)
    {
        var (status, title) = failure switch
        {
            RampOperationsFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            RampOperationsFailure.Forbidden => (StatusCodes.Status403Forbidden, "Access to the ramp operation is forbidden."),
            RampOperationsFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The ramp charge request is invalid."),
            RampOperationsFailure.NotFound => (StatusCodes.Status404NotFound, "The ramp operation or service was not found."),
            _ => (StatusCodes.Status409Conflict, "The charge conflicts with the current state of the service."),
        };
        if (status == StatusCodes.Status401Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
        { StatusCode = status };
    }
}
