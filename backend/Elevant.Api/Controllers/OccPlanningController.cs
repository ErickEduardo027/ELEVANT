using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Application.Operations.AssignOccOperation;
using Elevant.Application.Operations.CreateManualTurnaround;
using Elevant.Application.Operations.GetManualTurnaroundOptions;
using Elevant.Application.Operations.GetOccPlanningOptions;
using Elevant.Application.Operations.GetOccPlanningSnapshot;
using Elevant.Application.Operations.ProgramOccShift;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Exposes station-scoped OCC planning projections and guarded commands.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/planning")]
public sealed class OccPlanningController(
    GetOccPlanningSnapshotHandler snapshotHandler,
    GetOccPlanningOptionsHandler optionsHandler,
    AssignOccOperationHandler assignmentHandler,
    GetManualTurnaroundOptionsHandler manualOptionsHandler,
    CreateManualTurnaroundHandler createManualHandler,
    ProgramOccShiftHandler shiftHandler) : ControllerBase
{
    /// <summary>Returns the planning snapshot for an authorized station and operation date.</summary>
    [HttpGet(Name = "GetOccPlanningSnapshot")]
    [ProducesResponseType<OccPlanningSnapshotResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<OccPlanningSnapshotResponse>> GetSnapshot(
        [FromQuery] Guid? stationId,
        [FromQuery] DateOnly? date,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return UnauthorizedResult<OccPlanningSnapshotResponse>();
        }

        var result = await snapshotHandler.HandleAsync(
            new GetOccPlanningSnapshotQuery(accountId, stationId, date),
            cancellationToken);

        return result.IsSuccess
            ? Ok(Map(result.Snapshot!))
            : FailureResult<OccPlanningSnapshotResponse>(result.Failure!.Value);
    }

    /// <summary>Returns contract services and agent eligibility for one scoped turnaround.</summary>
    [HttpGet("options", Name = "GetOccPlanningOptions")]
    [ProducesResponseType<OccPlanningOptionsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<OccPlanningOptionsResponse>> GetOptions(
        [FromQuery, BindRequired] Guid turnaroundId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return UnauthorizedResult<OccPlanningOptionsResponse>();
        }

        var result = await optionsHandler.HandleAsync(
            new GetOccPlanningOptionsQuery(accountId, turnaroundId),
            cancellationToken);

        if (!result.IsSuccess)
        {
            return FailureResult<OccPlanningOptionsResponse>(result.Failure!.Value);
        }

        SetEntityTag(result.Options!.Turnaround.ConcurrencyToken);
        return Ok(Map(result.Options));
    }

    /// <summary>Returns current contract airlines and airports for manual OCC entry.</summary>
    [HttpGet("manual-options", Name = "GetManualTurnaroundOptions")]
    [ProducesResponseType<ManualTurnaroundOptionsResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<ManualTurnaroundOptionsResponse>> GetManualOptions(
        [FromQuery, BindRequired] Guid stationId,
        [FromQuery, BindRequired] DateOnly date,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return UnauthorizedResult<ManualTurnaroundOptionsResponse>();

        var result = await manualOptionsHandler.HandleAsync(
            new GetManualTurnaroundOptionsQuery(accountId, stationId, date), cancellationToken);
        return result.IsSuccess
            ? Ok(Map(result.Options!))
            : FailureResult<ManualTurnaroundOptionsResponse>(result.Failure!.Value);
    }

    /// <summary>Creates one contract-covered manual flight and planned operation.</summary>
    [HttpPost("turnarounds", Name = "CreateManualTurnaround")]
    [RequestSizeLimit(ApiConfiguration.ManualTurnaroundRequestBodyLimitBytes)]
    [Consumes("application/json")]
    [ProducesResponseType<ManualTurnaroundResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ManualTurnaroundResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<ManualTurnaroundResponse>> CreateManual(
        [FromBody, BindRequired] CreateManualTurnaroundRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return UnauthorizedResult<ManualTurnaroundResponse>();

        var result = await createManualHandler.HandleAsync(new CreateManualTurnaroundCommand(
            accountId, request.TurnaroundId, request.StationId, request.AirlineId,
            request.StandId,
            request.OperationDate, request.ArrivalFlightNumber, request.ArrivalOriginIata,
            request.ArrivalScheduledAt, request.DepartureFlightNumber,
            request.DepartureDestinationIata, request.DepartureScheduledAt,
            Guid.NewGuid(), HttpContext.TraceIdentifier, request.Charter), cancellationToken);
        if (!result.IsSuccess)
            return FailureResult<ManualTurnaroundResponse>(result.Failure!.Value);

        var response = new ManualTurnaroundResponse(result.TurnaroundId!.Value,
            result.OperationCode!, result.Replayed);
        return StatusCode(result.Replayed ? StatusCodes.Status200OK : StatusCodes.Status201Created,
            response);
    }

    /// <summary>Programs one scoped agent shift before the normal OCC assignment.</summary>
    [HttpPost("turnarounds/{turnaroundId:guid}/shift", Name = "ProgramOccShift")]
    [RequestSizeLimit(ApiConfiguration.OccShiftRequestBodyLimitBytes)]
    [Consumes("application/json")]
    [ProducesResponseType<ProgramOccShiftResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProgramOccShiftResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<ProgramOccShiftResponse>> ProgramShift(
        [FromRoute] Guid turnaroundId,
        [FromBody, BindRequired] ProgramOccShiftRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return UnauthorizedResult<ProgramOccShiftResponse>();

        var result = await shiftHandler.HandleAsync(new ProgramOccShiftCommand(
            accountId, turnaroundId, request.AgentId,
            request.StartsAtLocal, request.EndsAtLocal,
            Guid.NewGuid(), HttpContext.TraceIdentifier), cancellationToken);
        if (!result.IsSuccess)
            return FailureResult<ProgramOccShiftResponse>(result.Failure!.Value);

        return StatusCode(result.Replayed ? StatusCodes.Status200OK : StatusCodes.Status201Created,
            new ProgramOccShiftResponse(turnaroundId, result.ShiftId!.Value, result.Replayed));
    }

    /// <summary>Assigns one eligible agent and materializes all applicable contracted services.</summary>
    [RequestSizeLimit(ApiConfiguration.OccAssignmentRequestBodyLimitBytes)]
    [HttpPost("turnarounds/{turnaroundId:guid}/assignment", Name = "AssignOccPlanningOperation")]
    [Consumes("application/json")]
    [ProducesResponseType<OccAssignmentResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<OccAssignmentResponse>> Assign(
        [FromRoute] Guid turnaroundId,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        [FromBody, BindRequired] AssignOccOperationRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return UnauthorizedResult<OccAssignmentResponse>();
        }

        var precondition = ParseStrongEntityTag(ifMatch);
        if (precondition.Status == EntityTagParseStatus.Missing)
        {
            return ProblemResult<OccAssignmentResponse>(
                StatusCodes.Status428PreconditionRequired,
                "An If-Match precondition is required.");
        }

        if (precondition.Status == EntityTagParseStatus.Invalid)
        {
            return ProblemResult<OccAssignmentResponse>(
                StatusCodes.Status400BadRequest,
                "The OCC planning request is invalid.");
        }

        var result = await assignmentHandler.HandleAsync(
            new AssignOccOperationCommand(
                accountId,
                turnaroundId,
                request.AgentId,
                precondition.Token!,
                Guid.NewGuid(),
                HttpContext.TraceIdentifier),
            cancellationToken);

        if (!result.IsSuccess)
        {
            return FailureResult<OccAssignmentResponse>(result.Failure!.Value);
        }

        SetEntityTag(result.Assignment!.ConcurrencyToken);
        return Ok(Map(result.Assignment));
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> FailureResult<T>(OccPlanningFailure failure) => failure switch
    {
        OccPlanningFailure.Unauthorized => UnauthorizedResult<T>(),
        OccPlanningFailure.Forbidden => ProblemResult<T>(
            StatusCodes.Status403Forbidden,
            "Access to OCC planning is forbidden."),
        OccPlanningFailure.InvalidRequest => ProblemResult<T>(
            StatusCodes.Status400BadRequest,
            "The OCC planning request is invalid."),
        OccPlanningFailure.NotFound => ProblemResult<T>(
            StatusCodes.Status404NotFound,
            "The OCC planning resource was not found."),
        OccPlanningFailure.Conflict => ProblemResult<T>(
            StatusCodes.Status409Conflict,
            "The OCC planning request conflicts with current operational data."),
        OccPlanningFailure.PreconditionFailed => ProblemResult<T>(
            StatusCodes.Status412PreconditionFailed,
            "The OCC planning context has changed."),
        _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Unsupported failure."),
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

    private static OccPlanningSnapshotResponse Map(OccPlanningSnapshotData snapshot) => new(
        Map(snapshot.Station),
        snapshot.Date,
        snapshot.Turnarounds.Select(Map).ToArray());

    private static OccTurnaroundResponse Map(OccTurnaroundData turnaround) => new(
        turnaround.Id,
        turnaround.OperationCode,
        turnaround.OperationDate,
        turnaround.Status,
        new OccAirlineResponse(
            turnaround.Airline.Id,
            turnaround.Airline.IataCode,
            turnaround.Airline.IcaoCode,
            turnaround.Airline.Name),
        turnaround.Aircraft is null
            ? null
            : new OccAircraftResponse(
                turnaround.Aircraft.Id,
                turnaround.Aircraft.IcaoCode,
                turnaround.Aircraft.IataCode,
                turnaround.Aircraft.Manufacturer,
                turnaround.Aircraft.Model,
                turnaround.Aircraft.Registration),
        Map(turnaround.Stand),
        Map(turnaround.Arrival),
        Map(turnaround.Departure),
        turnaround.Operation is null
            ? null
            : new OccGroundOperationResponse(
                turnaround.Operation.Id,
                turnaround.Operation.Status,
                turnaround.Operation.PlannedStartAt,
                turnaround.Operation.PlannedEndAt,
                turnaround.Operation.ActualStartAt,
                turnaround.Operation.ActualEndAt),
        turnaround.Agents.Select(agent => new OccAssignedAgentResponse(
            agent.AssignmentId,
            agent.AgentId,
            agent.DisplayName,
            agent.EmployeeNumber,
            agent.PositionId,
            agent.PositionCode,
            agent.PositionName,
            agent.AssignmentRole,
            agent.AssignedAt)).ToArray(),
        turnaround.Equipment.Select(item => new OccAssignedEquipmentResponse(
            item.AssignmentId,
            item.EquipmentId,
            item.AssetCode,
            item.EquipmentTypeId,
            item.EquipmentTypeCode,
            item.EquipmentTypeName,
            item.Status,
            item.AssignedAt)).ToArray(),
        turnaround.Services.Select(service => new OccOperationServiceResponse(
            service.Id,
            service.LineNumber,
            service.ServiceDefinitionId,
            service.Code,
            service.Name,
            service.ContractedQuantity,
            service.ExecutedQuantity,
            service.BillingUnit,
            service.Status)).ToArray());

    private static OccFlightLegResponse? Map(OccFlightLegData? leg) => leg is null
        ? null
        : new OccFlightLegResponse(
            leg.Id,
            leg.FlightNumber,
            new OccAirportResponse(
                leg.Origin.Id,
                leg.Origin.IataCode,
                leg.Origin.IcaoCode,
                leg.Origin.Name),
            new OccAirportResponse(
                leg.Destination.Id,
                leg.Destination.IataCode,
                leg.Destination.IcaoCode,
                leg.Destination.Name),
            leg.ScheduledAt,
            leg.EstimatedAt,
            leg.ActualAt);

    private static OccStandResponse? Map(OccStandData? stand) => stand is null
        ? null
        : new OccStandResponse(
            stand.Id,
            stand.Code,
            stand.Terminal is null
                ? null
                : new OccTerminalResponse(
                    stand.Terminal.Id,
                    stand.Terminal.Code,
                    stand.Terminal.Name));

    private static OccStationResponse Map(OccStationData station) => new(
        station.Id,
        station.Code,
        station.Name,
        station.IanaTimeZone);

    private static OccPlanningOptionsResponse Map(OccPlanningOptionsData options) => new(
        new OccPlanningTurnaroundContextResponse(
            options.Turnaround.Id,
            options.Turnaround.OperationCode,
            options.Turnaround.OperationDate,
            Map(options.Turnaround.Station),
            Map(options.Turnaround.Stand),
            options.Turnaround.ReferenceTime),
        options.Contract is null
            ? null
            : new OccContractOptionResponse(
                options.Contract.Id,
                options.Contract.Code,
                options.Contract.Version,
                options.Contract.ValidFrom,
                options.Contract.ValidTo,
                options.Contract.CurrencyCode),
        options.Services.Select(service => new OccServiceOptionResponse(
            service.Id,
            service.ServiceDefinitionId,
            service.Code,
            service.Name,
            service.BillingUnit,
            service.MinimumQuantity,
            service.UnitPrice,
            service.CurrencyCode)).ToArray(),
        options.Agents.Select(agent => new OccAgentOptionResponse(
            agent.Id,
            agent.DisplayName,
            agent.EmployeeNumber,
            agent.Eligible,
            agent.EligibilityReasons)).ToArray(),
        options.IsCharter);

    private static ManualTurnaroundOptionsResponse Map(ManualTurnaroundOptionsData options) => new(
        Map(options.Station), options.Date,
        new OccAirportResponse(options.StationAirport.Id, options.StationAirport.IataCode,
            options.StationAirport.IcaoCode, options.StationAirport.Name),
        options.Airlines.Select(airline => new ManualTurnaroundAirlineResponse(
            airline.Id, airline.IataCode, airline.Name)).ToArray(),
        options.Airports.Select(airport => new OccAirportResponse(airport.Id,
            airport.IataCode, airport.IcaoCode, airport.Name)).ToArray(),
        options.Stands.Select(stand => new OccStandResponse(stand.Id, stand.Code,
            stand.Terminal is null ? null : new OccTerminalResponse(
                stand.Terminal.Id, stand.Terminal.Code, stand.Terminal.Name))).ToArray());

    private static OccAssignmentResponse Map(OccAssignmentData assignment) => new(
        assignment.TurnaroundId,
        new OccGroundOperationResponse(
            assignment.Operation.Id,
            assignment.Operation.Status,
            assignment.Operation.PlannedStartAt,
            assignment.Operation.PlannedEndAt,
            assignment.Operation.ActualStartAt,
            assignment.Operation.ActualEndAt),
        new OccAssignedAgentResponse(
            assignment.Assignment.AssignmentId,
            assignment.Assignment.AgentId,
            assignment.Assignment.DisplayName,
            assignment.Assignment.EmployeeNumber,
            assignment.Assignment.PositionId,
            assignment.Assignment.PositionCode,
            assignment.Assignment.PositionName,
            assignment.Assignment.AssignmentRole,
            assignment.Assignment.AssignedAt),
        assignment.Services.Select(service => new OccOperationServiceResponse(
            service.Id,
            service.LineNumber,
            service.ServiceDefinitionId,
            service.Code,
            service.Name,
            service.ContractedQuantity,
            service.ExecutedQuantity,
            service.BillingUnit,
            service.Status)).ToArray());

    private void SetEntityTag(string token)
    {
        Response.Headers.ETag = $"\"{token}\"";
    }

    private static EntityTagParseResult ParseStrongEntityTag(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return new(EntityTagParseStatus.Missing, null);
        }

        if (value.Trim() != value ||
            value.StartsWith("W/", StringComparison.OrdinalIgnoreCase) ||
            value.Length < 3 ||
            value[0] != '"' ||
            value[^1] != '"' ||
            value.AsSpan(1, value.Length - 2).Contains('"'))
        {
            return new(EntityTagParseStatus.Invalid, null);
        }

        var token = value[1..^1];
        return OccPlanningConcurrencyToken.TryDecode(token, out _)
            ? new(EntityTagParseStatus.Valid, token)
            : new(EntityTagParseStatus.Invalid, null);
    }

    private enum EntityTagParseStatus
    {
        Missing,
        Invalid,
        Valid,
    }

    private sealed record EntityTagParseResult(EntityTagParseStatus Status, string? Token);
}
