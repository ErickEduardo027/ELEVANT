using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.Realtime;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Contracts.Realtime;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Recoverable, account- and station-scoped change hints for client reconciliation.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/changes")]
public sealed class AccountChangesController(
    IAccountChangeReadStore store,
    AccountChangeCursorCodec cursors) : ControllerBase
{
    [HttpGet(Name = "GetAccountChanges")]
    [ProducesResponseType<AccountChangeListResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<AccountChangeListResponse>> Get(
        [FromQuery] string? after,
        [FromQuery] int limit = 50,
        CancellationToken cancellationToken = default)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId) ||
            accountId == Guid.Empty)
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult(401, "Authentication failed.");
        }

        if (limit is < 1 or > 100)
            return ProblemResult(400, "The change feed limit is invalid.");

        long sequence = 0;
        if (Request.Query.ContainsKey("after") &&
            (Request.Query["after"].Count != 1 ||
             !cursors.TryDecode(after ?? string.Empty, accountId, out sequence)))
            return ProblemResult(400, "The change feed cursor is invalid.");

        var page = await store.ReadAsync(accountId, sequence, limit, cancellationToken);
        if (page is null)
            return ProblemResult(403, "The change feed is forbidden.");

        var changes = page.Changes.Select(item => new AccountChangeResponse(
            item.EventId, cursors.Encode(accountId, item.Sequence),
            item.Resource, item.ResourceId, item.OccurredAt)).ToArray();
        var nextCursor = changes.LastOrDefault()?.Cursor ?? after;
        return Ok(new AccountChangeListResponse(changes, nextCursor, page.HasMore));
    }

    private ActionResult<AccountChangeListResponse> ProblemResult(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = status };
}
