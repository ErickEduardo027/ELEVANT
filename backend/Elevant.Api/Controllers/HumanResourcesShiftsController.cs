using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources/shifts")]
public sealed class HumanResourcesShiftsController(
    IHumanResourcesShiftReadStore store,
    IHumanResourcesShiftWriteStore writeStore) : ControllerBase
{
    [HttpGet("options", Name = "GetHumanResourcesShiftAssignmentOptions")]
    [ProducesResponseType<HumanResourcesShiftAssignmentOptions>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> GetAssignmentOptions([FromQuery] Guid? rampProfileId,
        [FromQuery] DateOnly? workDate, CancellationToken cancellationToken = default)
    {
        if (rampProfileId is null || rampProfileId == Guid.Empty || workDate is null)
            return Problem(statusCode: 400, title: "Invalid shift assignment query.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.GetAssignmentOptionsAsync(actorId, rampProfileId.Value,
            workDate.Value, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpGet(Name = "ListHumanResourcesShifts")]
    [ProducesResponseType<HumanResourcesShiftPage>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to, [FromQuery] int page = 1,
        [FromQuery] int limit = 50, CancellationToken cancellationToken = default)
    {
        if (from is null || to is null || from > to ||
            to.Value.DayNumber - from.Value.DayNumber > 30 ||
            page < 1 || limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400, title: "Invalid shift range or paging parameters.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.ListAsync(actorId, from.Value, to.Value,
            page, limit, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpPut("{id:guid}", Name = "RecordHumanResourcesShift")]
    [Obsolete("Transitional OCC-only shift write; migrate to OCC scheduling when available.")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<HumanResourcesShiftRecorded>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Record(Guid id,
        [FromBody] RecordHumanResourcesShiftInput input,
        CancellationToken cancellationToken)
    {
        if (id == Guid.Empty) return Problem(statusCode: 400, title: "Invalid shift identifier.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.RecordAsync(actorId, id, input, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result.Shift),
            HumanResourcesShiftWriteFailure.Forbidden => Forbid(),
            HumanResourcesShiftWriteFailure.Invalid => Problem(statusCode: 400,
                title: "Invalid shift record."),
            HumanResourcesShiftWriteFailure.Conflict => Problem(statusCode: 409,
                title: "Shift conflicts with current state."),
            _ => throw new InvalidOperationException(),
        };
    }
}
