using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources/availability-requests")]
public sealed class HumanResourcesAvailabilityRequestsController(
    IHumanResourcesAvailabilityReadStore store,
    IHumanResourcesAvailabilityWriteStore writeStore) : ControllerBase
{
    [HttpGet(Name = "ListHumanResourcesAvailabilityRequests")]
    [ProducesResponseType<HumanResourcesAvailabilityRequestPage>(StatusCodes.Status200OK,
        "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden,
        "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to, [FromQuery] int page = 1,
        [FromQuery] int limit = 50, CancellationToken cancellationToken = default)
    {
        if (from is null || to is null || from > to ||
            to.Value.DayNumber - from.Value.DayNumber > 30 ||
            page < 1 || limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400,
                title: "Invalid availability range or paging parameters.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.ListAsync(actorId, from.Value, to.Value,
            page, limit, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpPut("{id:guid}", Name = "RecordHumanResourcesAvailabilityRequest")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<HumanResourcesAvailabilityWritten>(StatusCodes.Status200OK,
        "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict,
        "application/problem+json")]
    public async Task<IActionResult> Record(Guid id,
        [FromBody] RecordHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken)
    {
        if (id == Guid.Empty)
            return HumanResourcesProblems.Failure(this, 400, null, "invalid_availability_request");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.RecordAsync(actorId, id, input, cancellationToken);
        return MapWriteResult(result);
    }

    /// <summary>
    /// Approves, rejects or cancels a pending request. Approving a day off or a restriction releases the agent's
    /// coverages, unstarted operations and unstarted shifts of those days (2-N08); an operation in progress keeps
    /// the agent (<c>agent_has_operation_in_progress</c>). The Idempotency-Key and the expected version are
    /// optional while older clients exist (expand); a key needs the version.
    /// </summary>
    [HttpPost("{id:guid}/resolution", Name = "ResolveHumanResourcesAvailabilityRequest")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<HumanResourcesAvailabilityWritten>(StatusCodes.Status200OK,
        "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict,
        "application/problem+json")]
    public async Task<IActionResult> Resolve(Guid id,
        [FromBody] ResolveHumanResourcesAvailabilityInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (id == Guid.Empty)
            return HumanResourcesProblems.Failure(this, 400, null, "invalid_availability_request");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.ResolveAsync(actorId, id, input, idempotencyKey, cancellationToken);
        return MapWriteResult(result);
    }

    /// <summary>
    /// Cancels an approved absence that has not started, or shortens one that has not ended to a last day no
    /// earlier than yesterday (2-N22). Always with a reason, the version on screen and an Idempotency-Key; what
    /// the approval released does not come back.
    /// </summary>
    [HttpPost("{id:guid}/amendment", Name = "AmendHumanResourcesAvailabilityRequest")]
    [RequestSizeLimit(8192)]
    [Consumes("application/json")]
    [ProducesResponseType<HumanResourcesAvailabilityAmended>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Amend(Guid id,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] AmendHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.AmendAsync(actorId, id, input, idempotencyKey, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result.Amendment),
            HumanResourcesAvailabilityWriteFailure.Forbidden => Forbid(),
            HumanResourcesAvailabilityWriteFailure.NotFound => HumanResourcesProblems.Failure(this, 404, result.Code, "not_found"),
            HumanResourcesAvailabilityWriteFailure.Invalid => HumanResourcesProblems.Failure(this, 400, result.Code,
                "invalid_absence_amendment"),
            _ => HumanResourcesProblems.Failure(this, 409, result.Code, "version_conflict"),
        };
    }

    private IActionResult MapWriteResult(HumanResourcesAvailabilityWriteResult result) =>
        result.Failure switch
        {
            null => Ok(result.Request),
            HumanResourcesAvailabilityWriteFailure.Forbidden => Forbid(),
            HumanResourcesAvailabilityWriteFailure.Invalid => HumanResourcesProblems.Failure(this, 400, result.Code,
                "invalid_availability_request"),
            HumanResourcesAvailabilityWriteFailure.NotFound => HumanResourcesProblems.Failure(this, 404, result.Code,
                "not_found"),
            HumanResourcesAvailabilityWriteFailure.Conflict => HumanResourcesProblems.Failure(this, 409, result.Code,
                "availability_request_closed"),
            _ => throw new InvalidOperationException(),
        };
}
