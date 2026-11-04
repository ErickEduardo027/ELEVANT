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

/// <summary>
/// The Flight Report captured on the tablet (ADR-0031): one-tap milestones and flight data typed
/// once. Idempotent per device like every ramp command; the tablet may send them late from its
/// offline queue with the time the agent tapped.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampExecutionController(RampExecutionHandler handler) : ControllerBase
{
    private const long BodyLimitBytes = 2 * 1024;

    /// <summary>Records (or corrects) the time of one Flight Report milestone.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPut("{operationId:guid}/milestones/{code}", Name = "RecordRampMilestone")]
    [Consumes("application/json")]
    [ProducesResponseType<RampExecutionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<RampExecutionResponse>> RecordMilestone(
        [FromRoute] Guid operationId,
        [FromRoute] string code,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] RecordRampMilestoneRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        var (data, failure) = await handler.RecordMilestoneAsync(accountId, operationId, code, request.OccurredAt,
            installationId, idempotencyKey, HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(Map(data!));
    }

    /// <summary>Saves passengers, MTOW and the registration correction typed once on the ramp.</summary>
    [RequestSizeLimit(BodyLimitBytes)]
    [HttpPut("{operationId:guid}/flight-data", Name = "UpdateRampFlightData")]
    [Consumes("application/json")]
    [ProducesResponseType<RampExecutionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<RampExecutionResponse>> UpdateFlightData(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] UpdateRampFlightDataRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId)) return Failure(RampOperationsFailure.Unauthorized);
        var (data, failure) = await handler.UpdateFlightDataAsync(accountId, operationId, request.PassengersIn,
            request.PassengersOut, request.MtowKg, request.AircraftRegistration, installationId, idempotencyKey,
            HttpContext.TraceIdentifier, cancellationToken);
        return failure is { } error ? Failure(error) : Ok(Map(data!));
    }

    private static RampExecutionResponse Map(RampExecutionData data) => new(data.ReceiptId, data.OperationId,
        data.Milestones.Select(item => new RampMilestoneResponse(item.Code, item.ActualAt)).ToArray(),
        data.FlightData.PassengersIn, data.FlightData.PassengersOut, data.FlightData.MtowKg, data.AircraftRegistration);

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<RampExecutionResponse> Failure(RampOperationsFailure failure)
    {
        if (failure == RampOperationsFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
        var (status, title) = failure switch
        {
            RampOperationsFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
            RampOperationsFailure.Forbidden => (StatusCodes.Status403Forbidden, "Access to the ramp operation is forbidden."),
            RampOperationsFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The Flight Report entry is invalid."),
            RampOperationsFailure.NotFound => (StatusCodes.Status404NotFound, "The ramp operation was not found."),
            _ => (StatusCodes.Status409Conflict, "The Flight Report entry conflicts with the operation's current state."),
        };
        return new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
    }
}
