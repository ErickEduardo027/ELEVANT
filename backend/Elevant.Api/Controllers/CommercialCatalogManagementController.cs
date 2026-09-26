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

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/contracts/catalog/services")]
public sealed class CommercialCatalogManagementController(
    ICommercialCatalogManagementStore store,
    IHubContext<PublicCatalogHub> hub) : ControllerBase
{
    [HttpGet(Name = "ListManagedCommercialServices")]
    [ProducesResponseType<ManagedServiceData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var services = await store.ListAsync(actorId, cancellationToken);
        return services is null ? Forbid() : Ok(services);
    }

    [HttpPost(Name = "CreateCommercialService")]
    [ProducesResponseType<ManagedServiceData>(StatusCodes.Status201Created, "application/json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> Create([FromBody] ManagedServiceInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SaveAsync(actorId, null, input, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        await hub.Clients.All.SendAsync("CatalogChangedV1", cancellationToken);
        return StatusCode(201, result.Service);
    }

    [HttpPut("{id:guid}", Name = "UpdateCommercialService")]
    [ProducesResponseType<ManagedServiceData>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> Update(Guid id, [FromBody] ManagedServiceInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SaveAsync(actorId, id, input, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        await hub.Clients.All.SendAsync("CatalogChangedV1", cancellationToken);
        return Ok(result.Service);
    }

    [HttpDelete("{id:guid}", Name = "DeleteCommercialService")]
    [ProducesResponseType<ManagedServiceData>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] string version,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.DeleteAsync(actorId, id, version, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        await hub.Clients.All.SendAsync("CatalogChangedV1", cancellationToken);
        return Ok(result.Service);
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private IActionResult Failure(CatalogMutationFailure failure) => failure switch
    {
        CatalogMutationFailure.Forbidden => Forbid(),
        CatalogMutationFailure.Invalid => Problem(statusCode: 400, title: "Invalid service data."),
        CatalogMutationFailure.NotFound => Problem(statusCode: 404, title: "Service not found."),
        CatalogMutationFailure.Conflict => Problem(statusCode: 409, title: "Service changed; reload and retry."),
        _ => throw new InvalidOperationException(),
    };
}
