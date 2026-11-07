using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Elevant.Api.Controllers;

/// <summary>
/// One turnaround as OCC edits it from Planificación (3-A): its detail with a strong ETag, «Editar vuelo»,
/// «Cancelar vuelo» and «Marcar desviado» before the operation starts, and the minimal carrier of a charter (3-N21).
/// Every change takes an Idempotency-Key; the turnaround changes also its ETag in If-Match (missing: 428
/// <c>expected_version_required</c>; stale: 412 <c>version_conflict</c>). Failures carry a stable code and a Spanish title.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/planning")]
public sealed class OccTurnaroundsController(IOccTurnaroundStore store) : ControllerBase
{
    private const long BodyLimitBytes = 4 * 1024;

    /// <summary>The turnaround, its version (also the ETag) and the changes its state allows.</summary>
    [HttpGet("turnarounds/{turnaroundId:guid}", Name = "GetOccTurnaround")]
    [ProducesResponseType<OccTurnaroundDetailResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccTurnaroundDetailResponse>> Get([FromRoute] Guid turnaroundId,
        CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return Unauthenticated();
        return Answer(await store.ReadAsync(actorId, turnaroundId, cancellationToken));
    }

    /// <summary>
    /// «Editar vuelo»: corrects numbers, airports, times, stand and aircraft type before the operation starts. The stand
    /// is checked again for the new window, and an assigned agent must still be on shift and within three simultaneous
    /// operations (<c>assigned_agent_unavailable</c> with its reasons).
    /// </summary>
    [HttpPut("turnarounds/{turnaroundId:guid}/schedule", Name = "RescheduleOccTurnaround")]
    [RequestSizeLimit(BodyLimitBytes)]
    [Consumes("application/json")]
    [ProducesResponseType<OccTurnaroundDetailResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccTurnaroundDetailResponse>> Reschedule([FromRoute] Guid turnaroundId,
        [FromBody, BindRequired] RescheduleOccTurnaroundRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return Unauthenticated();
        if (!TryVersion(ifMatch, out var version)) return InvalidPrecondition();
        return Answer(await store.RescheduleAsync(actorId, turnaroundId, new RescheduleTurnaroundInput(
            request.ArrivalFlightNumber, request.ArrivalOriginIata, request.ArrivalScheduledAt, request.DepartureFlightNumber,
            request.DepartureDestinationIata, request.DepartureScheduledAt, request.StandId, request.AircraftTypeId,
            request.Reason, version), idempotencyKey, cancellationToken));
    }

    /// <summary>«Cancelar vuelo» or «Marcar desviado» before the start: the stand and the agents are released.</summary>
    [HttpPost("turnarounds/{turnaroundId:guid}/status-changes", Name = "ChangeOccTurnaroundStatus")]
    [RequestSizeLimit(BodyLimitBytes)]
    [Consumes("application/json")]
    [ProducesResponseType<OccTurnaroundDetailResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccTurnaroundDetailResponse>> ChangeStatus([FromRoute] Guid turnaroundId,
        [FromBody, BindRequired] ChangeOccTurnaroundStatusRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return Unauthenticated();
        if (!TryVersion(ifMatch, out var version)) return InvalidPrecondition();
        return Answer(await store.ChangeStatusAsync(actorId, turnaroundId,
            new TurnaroundStatusChangeInput(request.Outcome, request.Reason, version), idempotencyKey, cancellationToken));
    }

    /// <summary>
    /// Registers a carrier without contract for a charter (3-N21): 201 the first time, 200 when the key replays it. A
    /// designator already in use answers <c>airline_code_in_use</c> with the <c>airlineId</c> that holds it.
    /// </summary>
    [HttpPost("charter-airlines", Name = "CreateOccCharterAirline")]
    [RequestSizeLimit(BodyLimitBytes)]
    [Consumes("application/json")]
    [ProducesResponseType<OccCharterAirlineResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<OccCharterAirlineResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<OccCharterAirlineResponse>> CreateCharterAirline(
        [FromBody, BindRequired] CreateOccCharterAirlineRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return Unauthenticated();
        var result = await store.CreateCharterAirlineAsync(actorId,
            new CharterAirlineInput(request.Name, request.IcaoCode, request.IataCode), idempotencyKey, cancellationToken);
        // A creation carries no If-Match: a version conflict (a repeated deadlock) stays a 409 the screen retries.
        if (result.Failure is { } failure)
            return Problem(failure, result.Code, result.Reasons, result.ExistingId, preconditioned: false);
        var airline = result.Value!;
        return new ObjectResult(new OccCharterAirlineResponse(airline.Id, airline.IcaoCode, airline.IataCode, airline.Name))
            { StatusCode = result.Replayed ? StatusCodes.Status200OK : StatusCodes.Status201Created };
    }

    private ActionResult<OccTurnaroundDetailResponse> Answer(MasterDataResult<OccTurnaroundDetailData> result)
    {
        if (result.Failure is { } failure)
            return Problem(failure, result.Code, result.Reasons, result.ExistingId, preconditioned: true);
        var detail = result.Value!;
        Response.Headers.ETag = $"\"{detail.Version}\"";
        return Ok(new OccTurnaroundDetailResponse(OccPlanningController.Map(detail.Station),
            OccPlanningController.Map(detail.Turnaround), detail.Version, detail.IsCharter, detail.AllowedActions));
    }

    /// <summary>
    /// The coded Problem Details of a failure; with <paramref name="preconditioned"/> the command sent its version in
    /// If-Match, so a stale one is 412, otherwise 409.
    /// </summary>
    private ObjectResult Problem(MasterDataFailure failure, string? code, IReadOnlyList<string>? reasons, Guid? existingId,
        bool preconditioned)
    {
        var (status, fallback) = failure switch
        {
            MasterDataFailure.Forbidden => (StatusCodes.Status403Forbidden, "forbidden"),
            MasterDataFailure.NotFound => (StatusCodes.Status404NotFound, "not_found"),
            MasterDataFailure.Invalid => (StatusCodes.Status400BadRequest, "invalid_turnaround_change"),
            _ => (StatusCodes.Status409Conflict, "version_conflict"),
        };
        var resolved = code ?? fallback;
        status = resolved switch
        {
            "expected_version_required" => StatusCodes.Status428PreconditionRequired,
            // The version travels in If-Match: a stale one is a failed precondition, like Asignar and Revisión.
            "version_conflict" when preconditioned => StatusCodes.Status412PreconditionFailed,
            _ => status,
        };
        var problem = new ProblemDetails { Status = status, Title = Title(resolved), Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = resolved;
        if (reasons is { Count: > 0 }) problem.Extensions["reasons"] = reasons;
        if (existingId is { } airlineId) problem.Extensions["airlineId"] = airlineId;
        return new ObjectResult(problem) { StatusCode = status };
    }

    private static string Title(string code) => code switch
    {
        "forbidden" => "No tiene permiso para cambiar vuelos en esta planificación.",
        "not_found" => "El vuelo ya no existe o no está en su alcance.",
        "invalid_turnaround_change" => "Los datos del vuelo no son válidos.",
        "invalid_charter_airline" => "Los datos de la aerolínea no son válidos.",
        "idempotency_key_required" => "No se pudo identificar el envío.",
        "expected_version_required" => "Falta la versión del vuelo que se vio en pantalla.",
        "reason_required" => "Indique el motivo (entre 5 y 500 caracteres).",
        "operation_started" => "La operación ya inició: lo ejecutado se cierra en Revisión.",
        "turnaround_closed" => "El vuelo ya está cerrado, cancelado o desviado.",
        "assigned_agent_unavailable" => "El agente asignado no puede atender el nuevo horario.",
        "stand_unavailable" => "La posición no está disponible para el nuevo horario.",
        "aircraft_type_unavailable" => "El tipo de avión ya no está disponible.",
        "aircraft_type_locked" => "El tipo de avión ya no se puede cambiar: la operación ya se entregó.",
        "contract_not_in_force" => "La aerolínea no tiene un contrato vigente en la nueva fecha.",
        "contract_ambiguous" => "La aerolínea tiene más de un contrato vigente en la nueva fecha.",
        "airline_code_in_use" => "Ese código ya pertenece a una aerolínea registrada.",
        "idempotency_conflict" => "Ese envío ya se usó con otros datos.",
        _ => "El vuelo cambió mientras lo revisaba. Vuelva a cargarlo.",
    };

    /// <summary>The version a strong ETag carries; null when If-Match is missing; false when it cannot be read.</summary>
    private static bool TryVersion(string? ifMatch, out string? version)
    {
        version = null;
        if (string.IsNullOrWhiteSpace(ifMatch)) return true;
        if (ifMatch.Trim() != ifMatch || ifMatch.StartsWith("W/", StringComparison.OrdinalIgnoreCase) || ifMatch.Length < 3 ||
            ifMatch[0] != '"' || ifMatch[^1] != '"' || ifMatch.AsSpan(1, ifMatch.Length - 2).Contains('"'))
            return false;
        version = ifMatch[1..^1];
        return true;
    }

    private ObjectResult Unauthenticated()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails
        {
            Status = StatusCodes.Status401Unauthorized, Title = "Authentication failed.", Instance = HttpContext.Request.Path,
        }) { StatusCode = StatusCodes.Status401Unauthorized };
    }

    private ObjectResult InvalidPrecondition() =>
        MasterDataHttp.Coded(this, StatusCodes.Status400BadRequest, "La versión enviada en If-Match no es válida.",
            "invalid_turnaround_change");
}
