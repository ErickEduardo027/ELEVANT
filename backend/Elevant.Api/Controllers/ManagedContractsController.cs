using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/contracts/agreements")]
public sealed class ManagedContractsController(IManagedContractReadStore store) : ControllerBase
{
    [HttpGet(Name = "ListManagedContracts")]
    [ProducesResponseType<ManagedContractPageData>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 50 || (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400, title: "Invalid paging parameters.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.ListAsync(actorId, page, limit, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }
}
