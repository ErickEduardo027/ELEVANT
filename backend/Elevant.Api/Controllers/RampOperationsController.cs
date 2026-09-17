using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Application.Operations.GetRampAssignedOperations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Exposes the authenticated ramp agent's active assigned work.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampOperationsController(
    GetRampAssignedOperationsHandler handler) : ControllerBase
{
    /// <summary>Returns only active operations assigned to the current ramp agent.</summary>
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
            return UnauthorizedResult<RampAssignedOperationsResponse>();
        }

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(accountId),
            cancellationToken);

        return result.IsSuccess
            ? Ok(new RampAssignedOperationsResponse(
                result.Operations!.Select(Map).ToArray()))
            : FailureResult<RampAssignedOperationsResponse>(result.Failure!.Value);
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> FailureResult<T>(RampOperationsFailure failure) => failure switch
    {
        RampOperationsFailure.Unauthorized => UnauthorizedResult<T>(),
        RampOperationsFailure.Forbidden => ProblemResult<T>(
            StatusCodes.Status403Forbidden,
            "Access to ramp operations is forbidden."),
        _ => throw new ArgumentOutOfRangeException(
            nameof(failure),
            failure,
            "Unsupported failure."),
    };

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(
            StatusCodes.Status401Unauthorized,
            "Authentication failed.");
    }

    private ActionResult<T> ProblemResult<T>(int statusCode, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Instance = HttpContext.Request.Path,
        })
        {
            StatusCode = statusCode,
        };

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
            operation.Operation.ActualEndAt),
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
            service.Status)).ToArray());

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
