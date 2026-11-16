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
/// The planning board's marks on assigned agents who cannot do their operation (2-N25): inactive, on an approved
/// absence, or without a current airport permit or ramp licence. Read with the board; nothing is released.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/planning/assignment-readiness")]
public sealed class OccAssignmentReadinessController(IOccAssignmentReadinessStore store) : ControllerBase
{
    [HttpGet(Name = "GetOccAssignmentReadiness")]
    [ProducesResponseType<OccAssignmentReadinessResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<OccAssignmentReadinessResponse>> Get([FromQuery, BindRequired] Guid stationId,
        [FromQuery, BindRequired] DateOnly date, CancellationToken cancellationToken)
    {
        if (stationId == Guid.Empty || date == default)
            return HumanResourcesProblems.Coded(this, 400, "La consulta no es válida.", "invalid_readiness_query");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) || actorId == Guid.Empty)
            return Unauthorized();
        var result = await store.ReadAsync(actorId, stationId, date, cancellationToken);
        if (result.Failure == OccAssignmentReadinessFailure.Forbidden) return Forbid();
        if (result.Failure is not null)
            return HumanResourcesProblems.Coded(this, 404, "La estación no existe o no está en su alcance.", "not_found");
        var data = result.Data!;
        return Ok(new OccAssignmentReadinessResponse(data.StationId, data.Date,
            data.Assignments.Select(item => new OccUnfitAssignmentResponse(item.AssignmentId, item.TurnaroundId,
                item.AgentId, item.Reasons)).ToArray()));
    }
}
