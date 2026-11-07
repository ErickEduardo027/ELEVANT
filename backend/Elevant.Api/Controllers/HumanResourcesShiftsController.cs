using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Contracts.Identity;
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
            HumanResourcesShiftWriteFailure.Invalid => HumanResourcesProblems.Failure(this, 400, result.Code, "invalid_shift"),
            HumanResourcesShiftWriteFailure.Conflict => HumanResourcesProblems.Failure(this, 409, result.Code, "shift_day_taken"),
            _ => throw new InvalidOperationException(),
        };
    }

    /// <summary>
    /// Removes a shift of today or later in its station's calendar (ADR-0026, 2-N31); past shifts are history
    /// (<c>shift_in_past</c>) and a shift whose agent already covers stands or carries operations in it stays
    /// (<c>shift_in_use</c>, 2-N11). The expected version travels as <c>?version=</c>; it and the
    /// Idempotency-Key are optional while older clients exist (expand), and a key needs the version.
    /// </summary>
    [HttpDelete("{id:guid}", Name = "RemoveHumanResourcesShift")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Remove(Guid id, [FromQuery] string? version,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.RemoveAsync(actorId, id,
            new RemoveHumanResourcesShiftInput(version, idempotencyKey), cancellationToken);
        return result.Failure switch
        {
            null => NoContent(),
            HumanResourcesShiftWriteFailure.Forbidden => Forbid(),
            HumanResourcesShiftWriteFailure.Invalid => HumanResourcesProblems.Failure(this, 400, result.Code, "invalid_shift"),
            _ => HumanResourcesProblems.Failure(this, 409, result.Code, "shift_in_use"),
        };
    }

    /// <summary>
    /// «Ajustar horario» (3-E): Gestión Humana and OCC change the hours of a shift of today or later in its station's
    /// calendar, with a reason, the shift's <c>version</c> and an Idempotency-Key (required). The adjusted shift keeps
    /// covering the agent's coverages and operations in it (<c>shift_uncovers_work</c>); a past shift
    /// (<c>shift_in_past</c>) or one whose attendance was validated (<c>attendance_validated</c>) stays as it is.
    /// </summary>
    [HttpPatch("{id:guid}", Name = "AdjustHumanResourcesShift")]
    [RequestSizeLimit(8192)]
    [Consumes("application/json")]
    [ProducesResponseType<HumanResourcesShiftAdjusted>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Adjust(Guid id, [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        [FromBody] AdjustHumanResourcesShiftRequest request, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        if (request is null) return HumanResourcesProblems.Failure(this, 400, null, "invalid_shift");
        var result = await writeStore.AdjustAsync(actorId, id, new AdjustHumanResourcesShiftInput(request.StartsAtLocal,
            request.EndsAtLocal, request.Reason, request.ExpectedVersion), idempotencyKey, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result.Shift),
            HumanResourcesShiftWriteFailure.Forbidden => Forbid(),
            HumanResourcesShiftWriteFailure.Invalid => HumanResourcesProblems.Failure(this, 400, result.Code, "invalid_shift"),
            HumanResourcesShiftWriteFailure.NotFound => HumanResourcesProblems.Failure(this, 404, result.Code, "not_found"),
            _ => HumanResourcesProblems.Failure(this, 409, result.Code, "version_conflict"),
        };
    }
}
