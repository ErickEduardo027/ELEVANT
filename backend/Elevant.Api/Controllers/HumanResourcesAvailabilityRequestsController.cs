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
        if (id == Guid.Empty) return Problem(statusCode: 400,
            title: "Invalid availability request identifier.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.RecordAsync(actorId, id, input, cancellationToken);
        return MapWriteResult(result);
    }

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
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict,
        "application/problem+json")]
    public async Task<IActionResult> Resolve(Guid id,
        [FromBody] ResolveHumanResourcesAvailabilityInput input,
        CancellationToken cancellationToken)
    {
        if (id == Guid.Empty) return Problem(statusCode: 400,
            title: "Invalid availability request identifier.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.ResolveAsync(actorId, id, input, cancellationToken);
        return MapWriteResult(result);
    }

    private IActionResult MapWriteResult(HumanResourcesAvailabilityWriteResult result) =>
        result.Failure switch
        {
            null => Ok(result.Request),
            HumanResourcesAvailabilityWriteFailure.Forbidden => Forbid(),
            HumanResourcesAvailabilityWriteFailure.Invalid => Problem(statusCode: 400,
                title: "Invalid availability request."),
            HumanResourcesAvailabilityWriteFailure.Conflict => Problem(statusCode: 409,
                title: "Availability request conflicts with current state."),
            _ => throw new InvalidOperationException(),
        };
}
