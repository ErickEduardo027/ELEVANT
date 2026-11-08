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
/// Position coverage per shift (ADR-0030): OCC hands each agent their stands for the shift under
/// Pillier's rules and configures the stands, terminal limits and combined stands. A rejected
/// coverage answers 422 with the broken rules in <c>reasons</c>.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}")]
public sealed class OccCoverageController(IPositionCoverageStore store) : ControllerBase
{
    [HttpGet("occ/coverage", Name = "GetOccCoverage")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> Get([FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "date"), BindRequired] DateOnly date, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        if (stationId == Guid.Empty) return Problem<OccCoverageBoardResponse>(400, "The station is required.");
        return Map(await store.ReadAsync(actorId, stationId, date, cancellationToken));
    }

    /// <summary>
    /// Hands an agent their stands for a window of the shift (ADR-0030). 3-J: with an Idempotency-Key (optional while
    /// older clients exist) a repeated attempt answers the board instead of a second coverage; the key with another body
    /// is <c>idempotency_conflict</c>.
    /// </summary>
    [HttpPost("occ/coverage", Name = "CreateOccCoverage")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(422, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> Create([FromBody, BindRequired] CreateOccCoverageRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        if (request.StationId == Guid.Empty)
            return Coded<OccCoverageBoardResponse>(400, "La estación es obligatoria.", InvalidCoverageRequestCode);
        return Map(await store.CreateAsync(actorId, request.StationId, new CreateCoverageInput(request.AgentId, request.TerminalId,
            request.StandIds ?? [], request.Date, request.StartsAt, request.EndsAt, request.MentorAgentId, request.VehicleCode,
            request.IsReinforcement), idempotencyKey, cancellationToken));
    }

    /// <summary>Releases a coverage; releasing twice answers the board. The Idempotency-Key works as in the creation.</summary>
    [HttpPost("occ/coverage/{coverageId:guid}/release", Name = "ReleaseOccCoverage")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> Release([FromRoute] Guid coverageId,
        [FromQuery(Name = "date"), BindRequired] DateOnly date, [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        return Map(await store.ReleaseAsync(actorId, coverageId, date, idempotencyKey, cancellationToken));
    }

    /// <summary>
    /// The bridge, remote, size and active flags of a stand, under the master-data rules (2-A): a stand in use is not
    /// deactivated and one of an inactive terminal is not reactivated (422 with the rule in <c>reasons</c>). The
    /// Idempotency-Key and <c>expectedVersion</c> (the stand's version on the board) are optional while older screens
    /// exist (expand); with the key the version is required and a retry replays the first result.
    /// </summary>
    [HttpPut("occ/stands/{standId:guid}/attributes", Name = "UpdateOccStandAttributes")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(422, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> UpdateStand([FromRoute] Guid standId,
        [FromBody, BindRequired] UpdateOccStandAttributesRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        return Map(await store.UpdateStandAsync(actorId, standId, new StandAttributesInput(request.HasBoardingBridge,
            request.IsRemote, request.MaxAircraftSize, request.IsActive, request.ExpectedVersion), request.Date,
            idempotencyKey, cancellationToken));
    }

    [HttpPut("occ/terminals/{terminalId:guid}/coverage-rules", Name = "UpdateOccTerminalRules")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> UpdateTerminal([FromRoute] Guid terminalId,
        [FromBody, BindRequired] UpdateOccTerminalRulesRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        return Map(await store.UpdateTerminalAsync(actorId, terminalId,
            new TerminalRulesInput(request.MaxStandsPerAgent, request.RequiresBridgeQualification), request.Date, cancellationToken));
    }

    [HttpPost("occ/stand-constraints", Name = "AddOccStandConstraint")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> AddConstraint(
        [FromBody, BindRequired] AddOccStandConstraintRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        return Map(await store.AddConstraintAsync(actorId,
            new StandConstraintInput(request.StandId, request.AffectedStandId, request.Kind ?? string.Empty), request.Date,
            cancellationToken));
    }

    [HttpDelete("occ/stand-constraints/{constraintId:guid}", Name = "RemoveOccStandConstraint")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> RemoveConstraint([FromRoute] Guid constraintId,
        [FromQuery(Name = "date"), BindRequired] DateOnly date, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        return Map(await store.RemoveConstraintAsync(actorId, constraintId, date, cancellationToken));
    }

    /// <summary>
    /// Releases the agent of an operation not yet started so OCC can assign another (ADR-0030). 3-J:
    /// <c>expectedAssignmentId</c> is the assignment OCC saw (another one is <c>assignment_changed</c>) and the
    /// Idempotency-Key replays the release; both are optional while older clients exist, and a key needs the assignment
    /// (<c>expected_version_required</c>). A started operation is <c>operation_started</c>: OCC hands it over instead.
    /// </summary>
    [HttpPost("occ/planning/turnarounds/{turnaroundId:guid}/assignment/release", Name = "ReleaseOccOperationAgent")]
    [ProducesResponseType(204)]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<IActionResult> ReleaseAgent([FromRoute] Guid turnaroundId,
        [FromQuery(Name = "expectedAssignmentId")] Guid? expectedAssignmentId,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<object>().Result!;
        var result = await store.ReleaseOperationAgentAsync(actorId, turnaroundId,
            new ReleaseOperationAgentInput(expectedAssignmentId, idempotencyKey), cancellationToken);
        return result.Failure is null ? NoContent() : AgentFailure<object>(result.Failure.Value, result.Code).Result!;
    }

    /// <summary>
    /// «Relevar agente» (3-F): the agents who may take an operation in progress or returned for correction from its agent,
    /// with OCC's assignment rules over what is left of it. Another status is <c>handover_not_allowed</c>.
    /// </summary>
    [HttpGet("occ/planning/turnarounds/{turnaroundId:guid}/assignment/handover-options", Name = "GetOccHandoverOptions")]
    [ProducesResponseType<OccHandoverOptionsResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccHandoverOptionsResponse>> HandoverOptions([FromRoute] Guid turnaroundId,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccHandoverOptionsResponse>();
        var result = await store.ReadHandoverOptionsAsync(actorId, turnaroundId, cancellationToken);
        if (result.Value is not { } options) return AgentFailure<OccHandoverOptionsResponse>(result.Failure!.Value, result.Code);
        return Ok(new OccHandoverOptionsResponse(options.TurnaroundId, options.OperationId, options.OperationStatus,
            options.CurrentAssignmentId, options.CurrentAgentId, options.CurrentAgentName, options.RemainingFrom,
            options.RemainingUntil, options.Agents.Select(agent => new OccAgentOptionResponse(agent.Id, agent.DisplayName,
                agent.EmployeeNumber, agent.Eligible, agent.EligibilityReasons)).ToArray()));
    }

    /// <summary>
    /// «Relevar agente» (3-F): OCC hands an operation in progress or returned to another eligible agent, with the
    /// assignment it saw (<c>assignment_changed</c> otherwise), a reason of 5 to 500 characters and an Idempotency-Key
    /// (required). The operation keeps its status and evidence; both agents are told.
    /// </summary>
    [HttpPost("occ/planning/turnarounds/{turnaroundId:guid}/assignment/handover", Name = "HandOverOccOperation")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<OccOperationHandoverResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccOperationHandoverResponse>> HandOver([FromRoute] Guid turnaroundId,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromBody, BindRequired] HandOverOccOperationRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccOperationHandoverResponse>();
        var result = await store.HandOverOperationAsync(actorId, turnaroundId,
            new HandOverOperationInput(request.AgentId, request.ExpectedAssignmentId, request.Reason), idempotencyKey,
            cancellationToken);
        if (result.Value is not { } handover)
            return AgentFailure<OccOperationHandoverResponse>(result.Failure!.Value, result.Code);
        return Ok(new OccOperationHandoverResponse(handover.TurnaroundId, handover.AssignmentId, handover.AgentId,
            handover.PreviousAgentId, handover.Replayed));
    }

    /// <summary>«Mis posiciones de hoy»: the signed-in ramp agent's stand coverages for the next hours.</summary>
    [HttpGet("ramp/me/coverage", Name = "GetOwnRampCoverage")]
    [ProducesResponseType<RampOwnCoverageListResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<RampOwnCoverageListResponse>> Own(CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<RampOwnCoverageListResponse>();
        var own = await store.ReadOwnAsync(actorId, cancellationToken);
        if (own is null) return Problem<RampOwnCoverageListResponse>(403, "Only ramp agents have stand coverage.");
        return Ok(new RampOwnCoverageListResponse(own.Select(item => new RampOwnCoverageResponse(item.Id, item.StationCode,
            item.TerminalCode, item.Stands, item.StartsAt, item.EndsAt, item.MentorName, item.VehicleCode,
            item.IsReinforcement)).ToArray()));
    }

    /// <summary>Default codes of the coverage failures (3-J: every Problem Details carries one).</summary>
    private const string InvalidCoverageRequestCode = "invalid_coverage_request";

    private const string CoverageRejectedCode = "coverage_rejected";

    // A failure with a stable code carries it (version_conflict, idempotency_conflict, expected_version_required…);
    // otherwise it carries the default code of its status (3-J). A refused permission stays a bare 403 unless coded.
    private ActionResult<OccCoverageBoardResponse> Map(CoverageResult result) => result.Failure switch
    {
        PositionCoverageFailure.Forbidden => Problem<OccCoverageBoardResponse>(403, "Position coverage access is forbidden.",
            result.Code),
        PositionCoverageFailure.NotFound => Coded<OccCoverageBoardResponse>(404,
            "The station, agent, terminal or stand was not found.", result.Code ?? "not_found"),
        PositionCoverageFailure.Invalid => Coded<OccCoverageBoardResponse>(400, "The coverage request is invalid.",
            result.Code ?? InvalidCoverageRequestCode),
        PositionCoverageFailure.Conflict => Coded<OccCoverageBoardResponse>(409, "The data changed; read the board again.",
            result.Code ?? "version_conflict"),
        PositionCoverageFailure.Rejected => Rejected(result.Reasons, result.Code),
        _ => Ok(Board(result.Board!)),
    };

    private ActionResult<OccCoverageBoardResponse> Rejected(IReadOnlyList<string> reasons, string? code)
    {
        var problem = new ProblemDetails
        {
            Status = 422, Title = "The coverage breaks assignment rules.", Instance = HttpContext.Request.Path,
        };
        problem.Extensions["reasons"] = reasons;
        // A stand in use or of an inactive terminal (2-A): the same codes as the master-data screen; the broken rules
        // otherwise (3-J).
        problem.Extensions["code"] = code ?? CoverageRejectedCode;
        return new ObjectResult(problem) { StatusCode = 422 };
    }

    /// <summary>
    /// A failure of a command on an operation's agent (3-J, 3-F) with its stable code; a refused permission stays a bare
    /// 403. The titles are Spanish: the screens show the code's message, never the title.
    /// </summary>
    private ActionResult<T> AgentFailure<T>(PositionCoverageFailure failure, string? code) => failure switch
    {
        PositionCoverageFailure.Forbidden => Problem<T>(403, "Su acceso no permite asignar agentes en esta estación."),
        PositionCoverageFailure.NotFound => Coded<T>(404, "El vuelo no existe o no está en su alcance.", code ?? "not_found"),
        PositionCoverageFailure.Invalid => Coded<T>(400, "La solicitud no es válida.", code ?? "invalid_handover"),
        _ => Coded<T>(409, "El agente o la operación cambiaron. Vuelva a cargar los datos.", code ?? "version_conflict"),
    };

    private ActionResult<T> Coded<T>(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }

    private static OccCoverageBoardResponse Board(CoverageBoardData board) => new(board.StationId, board.StationCode, board.Date,
        board.Terminals.Select(item => new OccCoverageTerminalResponse(item.TerminalId, item.Code, item.Name,
            item.MaxStandsPerAgent, item.RequiresBridgeQualification)).ToArray(),
        board.Stands.Select(item => new OccCoverageStandResponse(item.StandId, item.Code, item.TerminalId, item.IsActive,
            item.HasBoardingBridge, item.IsRemote, item.MaxAircraftSize, item.CoveredBy, item.Version)).ToArray(),
        board.Constraints.Select(item => new OccStandConstraintResponse(item.Id, item.StandId, item.StandCode,
            item.AffectedStandId, item.AffectedStandCode, item.Kind)).ToArray(),
        board.Agents.Select(item => new OccCoverageAgentResponse(item.AgentId, item.Name, item.EmployeeNumber, item.TerminalId,
            item.TerminalCode, item.ShiftStartsAt, item.ShiftEndsAt, item.IsJunior, item.HasAirportPermit,
            item.HasDriverLicense, item.HasBridgeQualification, item.IsAbsent)).ToArray(),
        board.Coverages.Select(item => new OccCoverageResponse(item.Id, item.AgentId, item.AgentName, item.TerminalId,
            item.TerminalCode, item.Stands.Select(stand => new OccCoverageStandRefResponse(stand.StandId, stand.Code)).ToArray(),
            item.StartsAt, item.EndsAt, item.MentorAgentId, item.MentorName, item.VehicleCode, item.IsReinforcement)).ToArray(),
        board.CanAssign, board.CanConfigure);

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return Problem<T>(401, "Authentication failed.");
    }

    private ActionResult<T> Problem<T>(int status, string title, string? code = null)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        if (code is not null) problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
