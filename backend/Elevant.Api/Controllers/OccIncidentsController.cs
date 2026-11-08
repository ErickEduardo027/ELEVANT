using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace Elevant.Api.Controllers;

/// <summary>
/// OCC manages the incidents of an operation of its stations (3-G) under <c>operations.incidents.*</c>: the live list,
/// its own reports and the state changes with their note and history. Every command takes an Idempotency-Key; a state
/// change also the incident's ETag in If-Match (missing: 428 <c>expected_version_required</c>; not a strong ETag: 400
/// <c>invalid_incident_request</c>; stale: 412 <c>version_conflict</c>). Failures carry a stable code and a Spanish
/// title.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ")]
public sealed class OccIncidentsController(IOccIncidentStore store) : ControllerBase
{
    private const long BodyLimitBytes = 8 * 1024;

    /// <summary>The live incidents of the operation, oldest first, with their history.</summary>
    [HttpGet("operations/{operationId:guid}/incidents", Name = "GetOccOperationIncidents")]
    [ProducesResponseType<OccIncidentListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccIncidentListResponse>> List([FromRoute] Guid operationId,
        CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return Unauthenticated();
        var result = await store.ListAsync(actorId, operationId, cancellationToken);
        if (result.Failure is { } failure) return Problem(failure, result.Code);
        var list = result.Value!;
        return Ok(new OccIncidentListResponse(list.OperationId, list.OperationCode, list.OperationStatus,
            list.IanaTimeZone, list.CanReport, list.Incidents.Select(Map).ToArray()));
    }

    /// <summary>OCC reports an incident of an operation still open: 201 the first time, 200 when the key replays it.</summary>
    [HttpPost("operations/{operationId:guid}/incidents", Name = "ReportOccIncident")]
    [RequestSizeLimit(BodyLimitBytes)]
    [Consumes("application/json")]
    [ProducesResponseType<OccIncidentResponse>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<OccIncidentResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<OccIncidentResponse>> Report([FromRoute] Guid operationId,
        [FromBody, BindRequired] ReportOccIncidentRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return Unauthenticated();
        var result = await store.ReportAsync(actorId, operationId, new OccIncidentReportInput(request.IncidentType,
            request.Severity, request.Description, request.OccurredAt, request.DelayCode), idempotencyKey, cancellationToken);
        // A report carries no If-Match: a repeated deadlock stays a 409 the screen retries with the same key.
        if (result.Failure is { } failure) return Problem(failure, result.Code, preconditioned: false);
        var incident = result.Value!;
        Response.Headers.ETag = $"\"{incident.Version}\"";
        return new ObjectResult(Map(incident))
            { StatusCode = result.Replayed ? StatusCodes.Status200OK : StatusCodes.Status201Created };
    }

    /// <summary>Takes an incident into review, resolves it, closes it or takes a resolved one back, with a note.</summary>
    [HttpPost("incidents/{incidentId:guid}/status", Name = "ChangeOccIncidentStatus")]
    [RequestSizeLimit(BodyLimitBytes)]
    [Consumes("application/json")]
    [ProducesResponseType<OccIncidentResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status412PreconditionFailed, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(428, "application/problem+json")]
    public async Task<ActionResult<OccIncidentResponse>> ChangeStatus([FromRoute] Guid incidentId,
        [FromBody, BindRequired] ChangeOccIncidentStatusRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromHeader(Name = "If-Match")] string? ifMatch, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return Unauthenticated();
        if (!TryVersion(ifMatch, out var version))
            return MasterDataHttp.Coded(this, StatusCodes.Status400BadRequest, Title(OccIncidentCodes.RequestInvalid),
                OccIncidentCodes.RequestInvalid);
        var result = await store.ChangeStatusAsync(actorId, incidentId,
            new OccIncidentStatusInput(request.Status, request.Note, version), idempotencyKey, cancellationToken);
        if (result.Failure is { } failure) return Problem(failure, result.Code);
        var incident = result.Value!;
        Response.Headers.ETag = $"\"{incident.Version}\"";
        return Ok(Map(incident));
    }

    private static OccIncidentResponse Map(OccIncidentData incident) => new(incident.Id, incident.Type, incident.Severity,
        incident.Status, incident.Description, incident.OccurredAt, incident.ReportedAt, incident.DelayCode,
        incident.ReportedBy, incident.ReportedByKind, incident.ResolutionNote, incident.ResolvedAt, incident.ResolvedBy,
        incident.Version, incident.AllowedStatuses,
        incident.History.Select(item => new OccIncidentEventResponse(item.FromStatus, item.ToStatus, item.Note,
            item.OccurredAt, item.Actor)).ToArray());

    /// <summary>
    /// The coded Problem Details of a failure; with <paramref name="preconditioned"/> the command sent its version in
    /// If-Match, so a stale one is 412, otherwise 409.
    /// </summary>
    private ObjectResult Problem(MasterDataFailure failure, string? code, bool preconditioned = true)
    {
        var (status, fallback) = failure switch
        {
            MasterDataFailure.Forbidden => (StatusCodes.Status403Forbidden, "forbidden"),
            MasterDataFailure.NotFound => (StatusCodes.Status404NotFound, "not_found"),
            MasterDataFailure.Invalid => (StatusCodes.Status400BadRequest, OccIncidentCodes.ReportInvalid),
            _ => (StatusCodes.Status409Conflict, "version_conflict"),
        };
        var resolved = code ?? fallback;
        status = resolved switch
        {
            "expected_version_required" => StatusCodes.Status428PreconditionRequired,
            "version_conflict" when preconditioned => StatusCodes.Status412PreconditionFailed,
            _ => status,
        };
        return MasterDataHttp.Coded(this, status, Title(resolved), resolved);
    }

    private static string Title(string code) => code switch
    {
        "forbidden" => "No tiene permiso para gestionar incidencias en esta estación.",
        "not_found" => "La operación o la incidencia ya no existe o no está en su alcance.",
        "idempotency_key_required" => "No se pudo identificar el envío.",
        "idempotency_conflict" => "Ese envío ya se usó con otros datos.",
        "expected_version_required" => "Falta la versión de la incidencia que se vio en pantalla.",
        "reason_required" => "Indique la nota (entre 8 y 2000 caracteres).",
        OccIncidentCodes.TransitionInvalid => "La incidencia no admite ese cambio de estado.",
        OccIncidentCodes.ReportInvalid => "Los datos de la incidencia no son válidos.",
        OccIncidentCodes.OccurredAtInvalid => "La hora de la incidencia está en el futuro o antes de la operación.",
        OccIncidentCodes.OperationClosed => "La operación ya está aprobada o cancelada.",
        OccIncidentCodes.RequestInvalid => "La versión enviada en If-Match no es válida.",
        _ => "La incidencia cambió mientras la revisaba. Vuelva a cargarla.",
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
}
