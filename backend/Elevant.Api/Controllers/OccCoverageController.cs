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
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        if (request.StationId == Guid.Empty) return Problem<OccCoverageBoardResponse>(400, "The station is required.");
        return Map(await store.CreateAsync(actorId, request.StationId, new CreateCoverageInput(request.AgentId, request.TerminalId,
            request.StandIds ?? [], request.Date, request.StartsAt, request.EndsAt, request.MentorAgentId, request.VehicleCode,
            request.IsReinforcement), cancellationToken));
    }

    [HttpPost("occ/coverage/{coverageId:guid}/release", Name = "ReleaseOccCoverage")]
    [ProducesResponseType<OccCoverageBoardResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OccCoverageBoardResponse>> Release([FromRoute] Guid coverageId,
        [FromQuery(Name = "date"), BindRequired] DateOnly date, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        return Map(await store.ReleaseAsync(actorId, coverageId, date, cancellationToken));
    }

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
        [FromBody, BindRequired] UpdateOccStandAttributesRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccCoverageBoardResponse>();
        return Map(await store.UpdateStandAsync(actorId, standId, new StandAttributesInput(request.HasBoardingBridge,
            request.IsRemote, request.MaxAircraftSize, request.IsActive), request.Date, cancellationToken));
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

    /// <summary>Releases the agent of an operation not yet started so OCC can assign another (ADR-0030).</summary>
    [HttpPost("occ/planning/turnarounds/{turnaroundId:guid}/assignment/release", Name = "ReleaseOccOperationAgent")]
    [ProducesResponseType(204)]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<IActionResult> ReleaseAgent([FromRoute] Guid turnaroundId, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<object>().Result!;
        return await store.ReleaseOperationAgentAsync(actorId, turnaroundId, cancellationToken) switch
        {
            null => NoContent(),
            PositionCoverageFailure.Forbidden => Problem<object>(403, "Planning assignment access is forbidden.").Result!,
            PositionCoverageFailure.NotFound => Problem<object>(404, "The turnaround was not found.").Result!,
            _ => Problem<object>(409, "Only an assigned operation that has not started can be released.").Result!,
        };
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

    private ActionResult<OccCoverageBoardResponse> Map(CoverageResult result) => result.Failure switch
    {
        PositionCoverageFailure.Forbidden => Problem<OccCoverageBoardResponse>(403, "Position coverage access is forbidden."),
        PositionCoverageFailure.NotFound => Problem<OccCoverageBoardResponse>(404, "The station, agent, terminal or stand was not found."),
        PositionCoverageFailure.Invalid => Problem<OccCoverageBoardResponse>(400, "The coverage request is invalid."),
        PositionCoverageFailure.Conflict => Problem<OccCoverageBoardResponse>(409, "The data changed; read the board again."),
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
        // A stand in use is not deactivated (2-A): the same code as the master-data screen.
        if (code is not null) problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = 422 };
    }

    private static OccCoverageBoardResponse Board(CoverageBoardData board) => new(board.StationId, board.StationCode, board.Date,
        board.Terminals.Select(item => new OccCoverageTerminalResponse(item.TerminalId, item.Code, item.Name,
            item.MaxStandsPerAgent, item.RequiresBridgeQualification)).ToArray(),
        board.Stands.Select(item => new OccCoverageStandResponse(item.StandId, item.Code, item.TerminalId, item.IsActive,
            item.HasBoardingBridge, item.IsRemote, item.MaxAircraftSize, item.CoveredBy)).ToArray(),
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

    private ActionResult<T> Problem<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
}
