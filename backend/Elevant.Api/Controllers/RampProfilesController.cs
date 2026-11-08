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
[Route("api/v{version:apiVersion}/human-resources/ramp-profiles")]
public sealed class RampProfilesController(IRampProfileStore store,
    IRampMobileAccessRequestStore accessRequests) : ControllerBase
{
    [HttpGet(Name = "ListRampProfiles")]
    [ProducesResponseType<RampProfileCatalog>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var profiles = await store.ListAsync(actorId, cancellationToken);
        return profiles is null ? Forbid() : Ok(profiles);
    }

    [HttpPost(Name = "CreateRampProfile")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<RampProfileData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Create([FromBody] SaveRampProfileInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Result(await store.SaveAsync(actorId, null, input, cancellationToken), 201);
    }

    /// <summary>
    /// Saves the operational profile with the <c>version</c> the editor read (<c>expectedVersion</c>) and the intent's
    /// Idempotency-Key, both optional while older screens exist (expand): with the key the version is required and a
    /// retry answers the first save. Deactivating it ends the agent's ramp duty through the release path (2-N06).
    /// </summary>
    [HttpPut("{id:guid}", Name = "UpdateRampProfile")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<RampProfileData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveRampProfileInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Result(await store.SaveAsync(actorId, id, input, idempotencyKey, cancellationToken), 200);
    }

    [HttpGet("access-requests", Name = "ListHumanResourcesMobileAccessRequests")]
    [ProducesResponseType<RampMobileAccessRequestData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> ListAccessRequests(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var rows = await accessRequests.ListForHumanResourcesAsync(actorId, cancellationToken);
        return rows is null ? Forbid() : Ok(rows);
    }

    [HttpPost("{id:guid}/access-requests", Name = "RequestRampMobileAccess")]
    [RequestSizeLimit(16384)]
    [ProducesResponseType<RampMobileAccessRequestData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> RequestAccess(Guid id, [FromBody] RampMobileAccessIntent input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return AccessRequestResult(await accessRequests.RequestAsync(actorId, id,
            input.RequestId, cancellationToken), 201);
    }

    private IActionResult AccessRequestResult(MobileAccessRequestResult result, int successStatus) =>
        result.Failure switch
        {
            null => StatusCode(successStatus, result.Request),
            MobileAccessRequestFailure.Forbidden => Forbid(),
            MobileAccessRequestFailure.Invalid => Problem(statusCode: 400, title: "Invalid mobile access request."),
            MobileAccessRequestFailure.NotFound => Problem(statusCode: 404, title: "Ramp profile not found."),
            MobileAccessRequestFailure.Conflict => Problem(statusCode: 409, title: "Mobile access request conflicts with current state."),
            _ => throw new InvalidOperationException(),
        };

    // Every refusal of a save carries its rule (2-N06): the store's code or the default of its kind, with a Spanish
    // title the clients never show. A refused permission stays a bare 403.
    private IActionResult Result(RampProfileResult result, int successStatus) => result.Failure switch
    {
        null => StatusCode(successStatus, result.Profile),
        RampProfileFailure.Forbidden => Forbid(),
        RampProfileFailure.Invalid => HumanResourcesProblems.Failure(this, 400, result.Code, "invalid_ramp_profile"),
        RampProfileFailure.NotFound => HumanResourcesProblems.Failure(this, 404, result.Code, "not_found"),
        RampProfileFailure.Conflict => HumanResourcesProblems.Failure(this, 409, result.Code, "ramp_profile_conflict"),
        _ => throw new InvalidOperationException(),
    };

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;
}

public sealed record RampMobileAccessIntent(Guid RequestId);
