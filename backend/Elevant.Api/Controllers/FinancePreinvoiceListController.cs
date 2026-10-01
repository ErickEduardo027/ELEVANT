using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/preinvoices")]
public sealed class FinancePreinvoiceListController(IFinancePreinvoiceListStore store) : ControllerBase
{
    [HttpGet(Name = "ListFinancePreinvoices")]
    [ProducesResponseType<FinancePreinvoicePageData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery, BindRequired] Guid stationId,
        [FromQuery] int page = 1, [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (stationId == Guid.Empty || page < 1 || limit is < 1 or > 50 ||
            (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400, title: "Invalid station or paging parameters.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId) ||
            accountId == Guid.Empty) return Unauthorized();
        var result = await store.ListAsync(accountId, stationId, page, limit, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }
}
