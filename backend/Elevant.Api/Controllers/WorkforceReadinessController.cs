using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Ramp agent readiness for Gestión Humana and the agent's own schedule for the tablet (ADR-0026).
/// Both are reads; authorization is resolved from the session, never from the request.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}")]
public sealed class WorkforceReadinessController(IWorkforceReadinessStore store) : ControllerBase
{
    /// <summary>«¿Puede operar?» of every active ramp agent, with what is missing.</summary>
    [HttpGet("human-resources/ramp-profiles/readiness", Name = "ListRampAgentReadiness")]
    [ProducesResponseType<RampAgentReadinessData[]>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Readiness(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var rows = await store.ListReadinessAsync(actorId, cancellationToken);
        return rows is null ? Forbid() : Ok(rows);
    }

    /// <summary>The ramp agent's shifts (up to 31 days) and current documents.</summary>
    [HttpGet("ramp/me/schedule", Name = "GetOwnRampSchedule")]
    [ProducesResponseType<RampAgentScheduleData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> OwnSchedule([FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        CancellationToken cancellationToken)
    {
        if (from is null || to is null || to < from || to.Value.DayNumber - from.Value.DayNumber > 31)
            return Problem(statusCode: 400, title: "Invalid schedule range.");
        if (!TryActor(out var actorId)) return Unauthorized();
        var schedule = await store.GetOwnScheduleAsync(actorId, from.Value, to.Value, cancellationToken);
        return schedule is null ? Forbid() : Ok(schedule);
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
