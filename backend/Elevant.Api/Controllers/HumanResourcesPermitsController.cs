using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources/permits")]
public sealed class HumanResourcesPermitsController(
    IHumanResourcesPermitReadStore store) : ControllerBase
{
    [HttpGet(Name = "ListHumanResourcesPermits")]
    [ProducesResponseType<HumanResourcesPermitPage>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] int page = 1,
        [FromQuery] int limit = 50, [FromQuery] Guid? rampProfileId = null,
        [FromQuery] string? documentType = null, CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400, title: "Invalid paging parameters.");
        if ((rampProfileId is null) != (documentType is null) ||
            rampProfileId == Guid.Empty ||
            documentType is not null and not (nameof(PermitDocumentType.AirportId) or
                nameof(PermitDocumentType.RampDriverLicense)))
            return Problem(statusCode: 400, title: "Incomplete permit filter.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = rampProfileId is Guid agentId && documentType is not null
            ? await store.ListCurrentAsync(actorId, page, limit, agentId,
                Enum.Parse<PermitDocumentType>(documentType), cancellationToken)
            : await store.ListCurrentAsync(actorId, page, limit, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }
}
