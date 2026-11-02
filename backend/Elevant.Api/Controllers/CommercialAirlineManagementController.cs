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

    /// <summary>
    /// Checks the airline against public registries (Wikidata, then OpenFlights) and stores the
    /// verdict; a green check allows publishing it in step 2 of the public wizard (ADR-0023).
    /// </summary>
    [HttpPost("{id:guid}/registry-check", Name = "CheckManagedAirlineRegistry")]
    [ProducesResponseType<AirlineRegistryCheckResult>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> CheckRegistry(Guid id, [FromServices] IAirlineRegistryLookup registry,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var (key, failure) = await store.RegistryKeyAsync(actorId, id, cancellationToken);
        if (failure is not null) return Failure(failure.Value);
        var check = await registry.CheckAsync(key!.Name, key.IataCode, key.IcaoCode, cancellationToken);
        var result = await store.RecordRegistryCheckAsync(actorId, key, check, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value);
        if (check.Status != AirlineRegistryCheck.Unavailable) await InvalidateAsync();
        return Ok(new AirlineRegistryCheckResult(result.Airline!, check));
    }

    [HttpPost(Name = "CreateManagedAirline")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<ManagedAirlineData>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Create([FromBody] ManagedAirlineInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SaveAsync(actorId, null, input, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value, result.Code);
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
        if (result.Failure is not null) return Failure(result.Failure.Value, result.Code);
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

    private IActionResult Failure(CatalogMutationFailure failure, string? code = null) => failure switch
    {
        CatalogMutationFailure.Forbidden => Forbid(),
        CatalogMutationFailure.Invalid when code == "registry_check_required" => new ObjectResult(new ProblemDetails
        {
            Status = 400, Title = "Publishing needs a green registry check or a manual verification.",
            Extensions = { ["code"] = code },
        }) { StatusCode = 400 },
        CatalogMutationFailure.Invalid => Problem(statusCode: 400, title: "Invalid airline profile."),
        CatalogMutationFailure.NotFound => Problem(statusCode: 404, title: "Airline profile not found."),
        CatalogMutationFailure.Conflict => Problem(statusCode: 409, title: "Airline profile changed; reload and retry."),
        _ => throw new InvalidOperationException(),
    };
}
