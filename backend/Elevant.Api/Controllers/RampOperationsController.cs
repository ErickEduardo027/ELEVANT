using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Application.Operations.GetRampAssignedOperations;
using Elevant.Application.Operations.StartRampOperation;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Exposes the authenticated ramp agent's active assigned work.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[RampProblemDetails]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampOperationsController(
    GetRampAssignedOperationsHandler handler,
    StartRampOperationHandler startHandler) : ControllerBase
{
    /// <summary>
    /// The operations of the current ramp agent's queue (3-N01): assigned, in progress, handed over (pending or in review)
    /// and returned, then the ones OCC approved in the last 48 hours; the active ones first, at most 100.
    /// </summary>
    [HttpGet(Name = "GetRampAssignedOperations")]
    [ProducesResponseType<RampAssignedOperationsResponse>(
        StatusCodes.Status200OK,
        "application/json")]
    [ProducesResponseType<ProblemDetails>(
        StatusCodes.Status401Unauthorized,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(
        StatusCodes.Status403Forbidden,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(
        StatusCodes.Status429TooManyRequests,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(
        StatusCodes.Status500InternalServerError,
        "application/problem+json")]
    public async Task<ActionResult<RampAssignedOperationsResponse>> GetAssignedOperations(
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return RampProblems.Failure(this, RampOperationsFailure.Unauthorized);
        }

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(accountId),
            cancellationToken);

        return result.IsSuccess
            ? Ok(new RampAssignedOperationsResponse(
                result.Operations!.Select(Map).ToArray()))
            : RampProblems.Failure(this, result.Failure!.Value);
    }

    /// <summary>
    /// Starts one operation assigned to the authenticated ramp agent. The body is optional (3-I): the first version
    /// of the app posts no body and the server's time applies; a newer one sends the moment the agent tapped
    /// «Iniciar», which must not precede the assignment nor be more than a day old (409
    /// <c>time_outside_operation_window</c>).
    /// </summary>
    [HttpPost("{operationId:guid}/start", Name = "StartRampOperation")]
    [ProducesResponseType<RampOperationStartResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<RampOperationStartResponse>> Start(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        // No [Consumes]: the deployed APK posts no body and no content type, which must not answer 415.
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] StartRampOperationRequest? request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return RampProblems.Failure(this, RampOperationsFailure.Unauthorized);
        }

        var result = await startHandler.HandleAsync(
            new StartRampOperationCommand(
                accountId,
                operationId,
                installationId,
                idempotencyKey,
                idempotencyKey,
                HttpContext.TraceIdentifier,
                request?.StartedAt),
            cancellationToken);

        if (!result.IsSuccess)
        {
            // 3-N04, 3-I: a coded refusal keeps the status the deployed APK explains and adds the code the new one shows.
            return RampProblems.Failure(this, result.Failure!.Value, result.Code);
        }

        var start = result.Start!;
        return Ok(new RampOperationStartResponse(start.ReceiptId, Map(start.Operation)));
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private static RampAssignedOperationResponse Map(RampAssignedOperationData operation) => new(
        new RampAgentAssignmentResponse(
            operation.Assignment.Id,
            operation.Assignment.AgentId,
            operation.Assignment.Position is null
                ? null
                : new RampOperationalPositionResponse(
                    operation.Assignment.Position.Id,
                    operation.Assignment.Position.Code,
                    operation.Assignment.Position.Name),
            operation.Assignment.AssignmentRole,
            operation.Assignment.AssignedAt),
        new RampGroundOperationResponse(
            operation.Operation.Id,
            operation.Operation.Status,
            operation.Operation.PlannedStartAt,
            operation.Operation.PlannedEndAt,
            operation.Operation.ActualStartAt,
            operation.Operation.ActualEndAt,
            operation.Operation.PassengersIn,
            operation.Operation.PassengersOut,
            operation.Operation.MtowKg),
        Map(operation.Turnaround),
        operation.Services.Select(service => new RampOperationServiceResponse(
            service.Id,
            service.LineNumber,
            service.ServiceDefinitionId,
            service.Code,
            service.Name,
            service.ContractedQuantity,
            service.ExecutedQuantity,
            service.BillingUnit,
            service.Status)).ToArray(),
        operation.Review is null ? null : new RampReviewFeedbackResponse(
            operation.Review.SubmissionId,
            operation.Review.RevisionNumber,
            operation.Review.Status,
            operation.Review.ReturnReason),
        (operation.Milestones ?? []).Select(item => new RampMilestoneResponse(item.Code, item.ActualAt)).ToArray());

    private static RampGroundOperationResponse Map(RampGroundOperationData operation) => new(
        operation.Id,
        operation.Status,
        operation.PlannedStartAt,
        operation.PlannedEndAt,
        operation.ActualStartAt,
        operation.ActualEndAt,
        operation.PassengersIn,
        operation.PassengersOut,
        operation.MtowKg);

    private static RampTurnaroundResponse Map(RampTurnaroundData turnaround) => new(
        turnaround.Id,
        turnaround.OperationCode,
        turnaround.OperationDate,
        turnaround.Status,
        new RampStationResponse(
            turnaround.Station.Id,
            turnaround.Station.Code,
            turnaround.Station.Name,
            turnaround.Station.IanaTimeZone),
        new RampAirlineResponse(
            turnaround.Airline.Id,
            turnaround.Airline.IataCode,
            turnaround.Airline.IcaoCode,
            turnaround.Airline.Name),
        turnaround.Aircraft is null
            ? null
            : new RampAircraftResponse(
                turnaround.Aircraft.Id,
                turnaround.Aircraft.IcaoCode,
                turnaround.Aircraft.IataCode,
                turnaround.Aircraft.Manufacturer,
                turnaround.Aircraft.Model,
                turnaround.Aircraft.Registration),
        turnaround.Stand is null
            ? null
            : new RampStandResponse(
                turnaround.Stand.Id,
                turnaround.Stand.Code,
                turnaround.Stand.Terminal is null
                    ? null
                    : new RampTerminalResponse(
                        turnaround.Stand.Terminal.Id,
                        turnaround.Stand.Terminal.Code,
                        turnaround.Stand.Terminal.Name)),
        Map(turnaround.Arrival),
        Map(turnaround.Departure));

    private static RampFlightLegResponse? Map(RampFlightLegData? leg) => leg is null
        ? null
        : new RampFlightLegResponse(
            leg.Id,
            leg.FlightNumber,
            new RampAirportResponse(
                leg.Origin.Id,
                leg.Origin.IataCode,
                leg.Origin.IcaoCode,
                leg.Origin.Name),
            new RampAirportResponse(
                leg.Destination.Id,
                leg.Destination.IataCode,
                leg.Destination.IcaoCode,
                leg.Destination.Name),
            leg.ScheduledAt,
            leg.EstimatedAt,
            leg.ActualAt);
}
