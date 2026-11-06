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

    // Every failure carries a code (the screens explain it); the defaults name the usual cause.
    private IActionResult Failure(CatalogMutationFailure failure, string? code = null) => failure switch
    {
        CatalogMutationFailure.Forbidden => Forbid(),
        CatalogMutationFailure.Invalid when code == "registry_check_required" =>
            Coded(400, "Para publicarla hace falta el registro público en verde o una verificación manual.", code),
        CatalogMutationFailure.Invalid => Coded(400, "La ficha de la aerolínea no es válida.", code ?? "invalid_airline"),
        CatalogMutationFailure.NotFound => Coded(404, "La ficha de la aerolínea ya no existe.", code ?? "not_found"),
        CatalogMutationFailure.Conflict => Coded(409, "La ficha cambió o entra en conflicto con otra aerolínea.",
            code ?? "version_conflict"),
        _ => throw new InvalidOperationException(),
    };

    private ObjectResult Coded(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
