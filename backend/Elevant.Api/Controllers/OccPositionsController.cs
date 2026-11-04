using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Real stand occupancy for the OCC positions map: arrival, assignment and release.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ")]
public sealed class OccPositionsController(IOccPositionStore store) : ControllerBase
{
    [HttpGet("positions", Name = "GetOccPositions")]
    [ProducesResponseType<OccPositionBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Get([FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "date"), BindRequired] DateOnly date, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        if (stationId == Guid.Empty) return Problem<OccPositionBoardResponse>(400, "The station is required.");
        return Map(await store.ReadAsync(actorId, stationId, date, cancellationToken));
    }

    [HttpPost("turnarounds/{turnaroundId:guid}/arrival", Name = "RecordOccArrival")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<OccPositionBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Arrival([FromRoute] Guid turnaroundId,
        [FromBody, BindRequired] RecordOccArrivalRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        return Map(await store.RecordArrivalAsync(actorId, turnaroundId,
            new RecordArrivalInput(request.AircraftRegistration, request.ArrivedAt), cancellationToken));
    }

    [HttpPost("turnarounds/{turnaroundId:guid}/stand", Name = "AssignOccStand")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<OccPositionBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Assign([FromRoute] Guid turnaroundId,
        [FromBody, BindRequired] AssignOccStandRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        if (request.StandId == Guid.Empty) return Problem<OccPositionBoardResponse>(400, "The stand is required.");
        return Map(await store.AssignAsync(actorId, turnaroundId, request.StandId, request.Reason, cancellationToken));
    }

    /// <summary>Places a stand on the map, or clears it (ADR-0027).</summary>
    [HttpPut("stands/{standId:guid}/location", Name = "LocateOccStand")]
    [RequestSizeLimit(2048)]
    [ProducesResponseType<OccPositionBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Locate([FromRoute] Guid standId,
        [FromBody, BindRequired] LocateOccStandRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        return Map(await store.LocateStandAsync(actorId, standId, request.Latitude, request.Longitude, request.OperationDate,
            cancellationToken));
    }

    [HttpPost("turnarounds/{turnaroundId:guid}/stand/release", Name = "ReleaseOccStand")]
    [ProducesResponseType<OccPositionBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Release([FromRoute] Guid turnaroundId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        return Map(await store.ReleaseAsync(actorId, turnaroundId, cancellationToken));
    }

    private ActionResult<OccPositionBoardResponse> Map(OccPositionResult result) => result.Failure switch
    {
        OccPositionFailure.Forbidden => Problem<OccPositionBoardResponse>(403, "OCC positions access is forbidden."),
        OccPositionFailure.NotFound => Problem<OccPositionBoardResponse>(404, "The station, turnaround or stand was not found."),
        OccPositionFailure.Invalid => Problem<OccPositionBoardResponse>(400, "The position request is invalid."),
        OccPositionFailure.Conflict when result.Reasons is { Count: > 0 } reasons => Rejected(reasons),
        OccPositionFailure.Conflict => Problem<OccPositionBoardResponse>(409, "The stand is not available for this turnaround."),
        _ => Ok(Board(result.Board!)),
    };

    private static OccPositionBoardResponse Board(OccPositionBoardData board) => new(board.StationId, board.StationCode,
        board.OperationDate, board.AsOf,
        board.Positions.Select(position => new OccPositionResponse(position.StandId, position.Code, position.TerminalCode,
            position.StandType, position.Status, position.Turnarounds.Select(Turnaround).ToArray(), position.Latitude,
            position.Longitude, position.HasBoardingBridge, position.IsRemote, position.MaxAircraftSize, position.CancelledBy,
            position.NarrowbodyOnly, position.CoveredBy ?? [])).ToArray(),
        board.Unassigned.Select(Turnaround).ToArray(), board.CanAssign);

    private static OccPositionTurnaroundResponse Turnaround(OccPositionTurnaroundData item) => new(item.TurnaroundId,
        item.OperationCode, item.AirlineName, item.AircraftRegistration, item.ArrivalFlightNumber, item.DepartureFlightNumber,
        item.ArrivalScheduledAt, item.ArrivedAt, item.DepartureScheduledAt, item.AssignedFrom, item.Status);

    /// <summary>A combined-stand rule blocks the stand (ADR-0030); the codes go in <c>reasons</c>.</summary>
    private ActionResult<OccPositionBoardResponse> Rejected(IReadOnlyList<string> reasons)
    {
        var problem = new ProblemDetails { Status = 409, Title = "The stand combination is not allowed.", Instance = HttpContext.Request.Path };
        problem.Extensions["reasons"] = reasons;
        return new ObjectResult(problem) { StatusCode = 409 };
    }

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return Problem<T>(401, "Authentication failed.");
    }

    private ActionResult<T> Problem<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
}
