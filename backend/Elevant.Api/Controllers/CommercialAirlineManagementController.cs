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
[Route("api/v{version:apiVersion}/governance/airlines")]
public sealed class CommercialAirlineManagementController(
    ICommercialAirlineManagementStore store,
    IHubContext<PublicCatalogHub> hub,
    ILogger<CommercialAirlineManagementController> logger) : ControllerBase
{
    [HttpGet(Name = "ListManagedAirlines")]
    [ProducesResponseType<ManagedAirlineData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var profiles = await store.ListAsync(actorId, cancellationToken);
        return profiles is null ? Forbid() : Ok(profiles);
    }

    [HttpPost("enrichment", Name = "EnrichManagedAirlines")]
    [ProducesResponseType<AirlineEnrichmentResult>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Enrich(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.EnrichHistoricalCatalogAsync(actorId, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        if (result.Changed > 0) await InvalidateAsync();
        return Ok(result);
    }

    [HttpPost(Name = "CreateManagedAirline")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<ManagedAirlineData>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] ManagedAirlineInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SaveAsync(actorId, null, input, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        await InvalidateAsync();
        return StatusCode(201, result.Airline);
    }

    [HttpPut("{id:guid}", Name = "UpdateManagedAirline")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<ManagedAirlineData>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Update(Guid id, [FromBody] ManagedAirlineInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SaveAsync(actorId, id, input, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        await InvalidateAsync();
        return Ok(result.Airline);
    }

    [HttpDelete("{id:guid}", Name = "ArchiveManagedAirline")]
    [ProducesResponseType<ManagedAirlineData>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Archive(Guid id, [FromQuery] string version,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ArchiveAsync(actorId, id, version, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        await InvalidateAsync();
        return Ok(result.Airline);
    }

    private Task InvalidateAsync() => PublicCatalogInvalidation.TrySendAsync(
        token => hub.Clients.All.SendAsync("CatalogChangedV1", token), logger);

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private IActionResult Failure(CatalogMutationFailure failure) => failure switch
    {
        CatalogMutationFailure.Forbidden => Forbid(),
        CatalogMutationFailure.Invalid => Problem(statusCode: 400, title: "Invalid airline profile."),
        CatalogMutationFailure.NotFound => Problem(statusCode: 404, title: "Airline profile not found."),
        CatalogMutationFailure.Conflict => Problem(statusCode: 409, title: "Airline profile changed; reload and retry."),
        _ => throw new InvalidOperationException(),
    };
}
