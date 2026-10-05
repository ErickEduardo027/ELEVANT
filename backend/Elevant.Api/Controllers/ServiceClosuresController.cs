using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.Hubs;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

public sealed record CreateServiceClosureRequest(Guid RequestId, Guid ServiceId,
    string Reason);
public sealed record DecideServiceClosureRequest(bool Approve, string? Reason,
    string Version);
public sealed record ReopenServiceRequest(string Reason, string ServiceVersion);

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/service-closures")]
public sealed class ServiceClosuresController(IServiceClosureStore store,
    IHubContext<PublicCatalogHub> hub,
    ILogger<ServiceClosuresController> logger) : ControllerBase
{
    [HttpGet(Name = "ListServiceClosures")]
    [ProducesResponseType<ServiceClosurePage>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List([FromQuery] string? status,
        [FromQuery] int page = 1, [FromQuery] int limit = 25,
        CancellationToken cancellationToken = default)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        if (page < 1 || limit is < 1 or > 100 ||
            page > int.MaxValue / limit ||
            status is not null && !new[] { "Pending", "Approved", "Denied" }
                .Contains(status, StringComparer.OrdinalIgnoreCase))
            return Problem(statusCode: 400, title: "Invalid filter.");
        var result = await store.ListAsync(actorId, status, page, limit,
            cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpPost(Name = "CreateServiceClosure")]
    [ProducesResponseType<ServiceClosureData>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Create([FromBody] CreateServiceClosureRequest input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.RequestAsync(actorId, input.RequestId,
            input.ServiceId, input.Reason, cancellationToken);
        return result.Failure is { } failure ? Failure(failure) :
            StatusCode(201, result.Request);
    }

    [HttpPost("{id:guid}/decision", Name = "DecideServiceClosure")]
    [ProducesResponseType<ServiceClosureData>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Decide(Guid id,
        [FromBody] DecideServiceClosureRequest input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.DecideAsync(actorId, id, input.Approve,
            input.Reason, input.Version, cancellationToken);
        if (result.Failure is { } failure) return Failure(failure);
        if (input.Approve) await BroadcastCatalogChangeAsync();
        return Ok(result.Request);
    }

    [HttpPost("services/{id:guid}/reopen", Name = "ReopenService")]
    [ProducesResponseType<ServiceClosureData>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Reopen(Guid id, [FromBody] ReopenServiceRequest input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ReopenAsync(actorId, id, input.Reason,
            input.ServiceVersion, cancellationToken);
        if (result.Failure is { } failure) return Failure(failure);
        await BroadcastCatalogChangeAsync();
        return Ok(result.Request);
    }

    private Task BroadcastCatalogChangeAsync() =>
        PublicCatalogInvalidation.TrySendAsync(
            token => hub.Clients.All.SendAsync("CatalogChangedV1", token), logger);

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private IActionResult Failure(ServiceClosureFailure failure) => failure switch
    {
        ServiceClosureFailure.Forbidden => Forbid(),
        ServiceClosureFailure.Invalid => Problem(statusCode: 400, title: "Invalid closure data."),
        ServiceClosureFailure.NotFound => Problem(statusCode: 404, title: "Service or request not found."),
        ServiceClosureFailure.Conflict => Problem(statusCode: 409,
            title: "Service or request changed; reload and retry."),
        _ => throw new InvalidOperationException(),
    };
}
