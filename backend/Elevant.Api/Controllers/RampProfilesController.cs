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
public sealed class RampProfilesController(IRampProfileStore store) : ControllerBase
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
    public async Task<IActionResult> Create([FromBody] SaveRampProfileInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Result(await store.SaveAsync(actorId, null, input, cancellationToken), 201);
    }

    [HttpPut("{id:guid}", Name = "UpdateRampProfile")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<RampProfileData>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(Guid id, [FromBody] SaveRampProfileInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        return Result(await store.SaveAsync(actorId, id, input, cancellationToken), 200);
    }

    private IActionResult Result(RampProfileResult result, int successStatus) => result.Failure switch
    {
        null => StatusCode(successStatus, result.Profile),
        RampProfileFailure.Forbidden => Forbid(),
        RampProfileFailure.Invalid => Problem(statusCode: 400, title: "Invalid ramp profile."),
        RampProfileFailure.NotFound => Problem(statusCode: 404, title: "Ramp profile not found."),
        RampProfileFailure.Conflict => Problem(statusCode: 409, title: "Ramp profile conflicts with current state."),
        _ => throw new InvalidOperationException(),
    };

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;
}
