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

/// <summary>
/// Real stand occupancy for the OCC positions map: arrival, assignment and release. The commands take an optional
/// Idempotency-Key and the turnaround's ETag in If-Match while older screens exist (expand, 3-N10); with a key the
/// If-Match is required. Every failure carries a stable code and a Spanish title; the new ETag travels in the header.
/// </summary>
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
        if (stationId == Guid.Empty) return Coded(400, "La estación es obligatoria.", "invalid_position_request");
        return Map(await store.ReadAsync(actorId, stationId, date, cancellationToken), false);
    }

    /// <summary>
    /// Records the arrival (registration, actual on-block time and optionally the aircraft type) or corrects a recorded
    /// one with its reason before the first submission (3-N08).
    /// </summary>
    [HttpPost("turnarounds/{turnaroundId:guid}/arrival", Name = "RecordOccArrival")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<OccPositionBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(412, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Arrival([FromRoute] Guid turnaroundId,
        [FromBody, BindRequired] RecordOccArrivalRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        if (!TryCommand(idempotencyKey, ifMatch, out var command)) return InvalidPrecondition();
        return Map(await store.RecordArrivalAsync(actorId, turnaroundId,
            new RecordArrivalInput(request.AircraftRegistration, request.ArrivedAt, request.AircraftTypeId, request.Reason),
            command, cancellationToken), ifMatch is not null);
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
    [ProducesResponseType<ProblemDetails>(412, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Assign([FromRoute] Guid turnaroundId,
        [FromBody, BindRequired] AssignOccStandRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        if (request.StandId == Guid.Empty) return Coded(400, "La posición es obligatoria.", "invalid_position_request");
        if (!TryCommand(idempotencyKey, ifMatch, out var command)) return InvalidPrecondition();
        return Map(await store.AssignAsync(actorId, turnaroundId, request.StandId, request.Reason, command, cancellationToken),
            ifMatch is not null);
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
            cancellationToken), false);
    }

    [HttpPost("turnarounds/{turnaroundId:guid}/stand/release", Name = "ReleaseOccStand")]
    [ProducesResponseType<OccPositionBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(412, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccPositionBoardResponse>> Release([FromRoute] Guid turnaroundId,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccPositionBoardResponse>();
        if (!TryCommand(idempotencyKey, ifMatch, out var command)) return InvalidPrecondition();
        return Map(await store.ReleaseAsync(actorId, turnaroundId, command, cancellationToken), ifMatch is not null);
    }

    /// <param name="result">The board after the command, or its failure with the stable code.</param>
    /// <param name="preconditioned">The request carried If-Match: a stale version is 412, otherwise 409.</param>
    private ActionResult<OccPositionBoardResponse> Map(OccPositionResult result, bool preconditioned)
    {
        if (result.Failure is { } failure)
        {
            // A refused permission keeps its uncoded 403, as this module always answered it.
            if (failure == OccPositionFailure.Forbidden)
                return new ObjectResult(new ProblemDetails
                {
                    Status = 403, Title = Title("forbidden"), Instance = HttpContext.Request.Path,
                }) { StatusCode = 403 };
            var code = result.Code ?? failure switch
            {
                OccPositionFailure.NotFound => "not_found",
                OccPositionFailure.Invalid => "invalid_position_request",
                _ => "version_conflict",
            };
            var status = code switch
            {
                "expected_version_required" => 428,
                "version_conflict" when preconditioned => 412,
                _ => failure switch
                {
                    OccPositionFailure.NotFound => 404,
                    OccPositionFailure.Invalid => 400,
                    _ => 409,
                },
            };
            return Coded(status, Title(code), code, result.Reasons);
        }
        if (result.Version is { } version) Response.Headers.ETag = $"\"{version}\"";
        return Ok(Board(result.Board!));
    }

    private static string Title(string code) => code switch
    {
        "forbidden" => "No tiene permiso para registrar llegadas ni asignar posiciones.",
        "not_found" => "La escala o la posición ya no existe o no está en su alcance.",
        "invalid_position_request" => "Los datos de la posición o de la llegada no son válidos.",
        "idempotency_key_required" => "No se pudo identificar el envío.",
        "expected_version_required" => "Falta la versión de la escala que se vio en pantalla.",
        "idempotency_conflict" => "Ese envío ya se usó con otros datos.",
        "reason_required" => "Indique el motivo de la corrección.",
        "arrival_locked" => "La llegada ya no se puede registrar ni corregir: la operación ya se entregó.",
        "aircraft_type_unavailable" => "El tipo de avión ya no está disponible.",
        "aircraft_type_locked" => "El tipo de avión ya no se puede cambiar: la operación ya se entregó.",
        "stand_unavailable" => "La posición no está disponible para esta escala.",
        "turnaround_closed" => "La escala ya está cerrada, cancelada o desviada.",
        _ => "La escala cambió mientras la revisaba. Vuelva a cargarla.",
    };

    /// <summary>The optional key and version of a command; false when the If-Match is not a strong ETag.</summary>
    private static bool TryCommand(Guid? idempotencyKey, string? ifMatch, out OccPositionCommand command)
    {
        command = OccPositionCommand.None;
        string? version = null;
        if (ifMatch is not null)
        {
            if (ifMatch.Trim() != ifMatch || ifMatch.StartsWith("W/", StringComparison.OrdinalIgnoreCase) ||
                ifMatch.Length < 3 || ifMatch[0] != '"' || ifMatch[^1] != '"' || ifMatch.AsSpan(1, ifMatch.Length - 2).Contains('"'))
                return false;
            version = ifMatch[1..^1];
        }
        command = new OccPositionCommand(idempotencyKey, version);
        return true;
    }

    private ObjectResult InvalidPrecondition() =>
        Coded(400, "La versión enviada en If-Match no es válida.", "invalid_position_request");

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

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails { Status = 401, Title = "Authentication failed.", Instance = HttpContext.Request.Path })
            { StatusCode = 401 };
    }

    /// <summary>A failure with its stable code and, for a refused stand, the rules it breaks in <c>reasons</c> (ADR-0030).</summary>
    private ObjectResult Coded(int status, string title, string code, IReadOnlyList<string>? reasons = null)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        if (reasons is { Count: > 0 }) problem.Extensions["reasons"] = reasons;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
