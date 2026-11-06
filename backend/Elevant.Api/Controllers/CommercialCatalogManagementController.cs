using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.Hubs;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.SignalR;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Contratos' catalog of services. «Ocultar del catálogo público» is an update that clears «Visible al
/// público» and keeps the service operable; «Dar de baja» is the retirement command, with a reason, and is
/// refused while a contract in force or in approval uses the service (1-N03). Every failure is Problem
/// Details with a stable code.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/contracts/catalog/services")]
public sealed class CommercialCatalogManagementController(
    ICommercialCatalogManagementStore store,
    IHubContext<PublicCatalogHub> hub,
    ILogger<CommercialCatalogManagementController> logger) : ControllerBase
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
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> Create([FromBody] ManagedServiceInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SaveAsync(actorId, null, input, null, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value, result.Code);
        await InvalidatePublicCatalogAsync();
        return StatusCode(201, result.Service);
    }

    /// <summary>
    /// Edits the service, hides it from or shows it in the public catalog, or reactivates a retired one;
    /// it never retires (<c>retirement_command_required</c>). The Idempotency-Key is optional while older
    /// clients exist (expand); <c>version</c> is the rowversion on screen.
    /// </summary>
    [HttpPut("{id:guid}", Name = "UpdateCommercialService")]
    [ProducesResponseType<ManagedServiceData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(32768)]
    public async Task<IActionResult> Update(Guid id, [FromBody] ManagedServiceInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.SaveAsync(actorId, id, input, idempotencyKey, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value, result.Code);
        await InvalidatePublicCatalogAsync();
        return Ok(result.Service);
    }

    /// <summary>
    /// «Dar de baja» (1-N03): the service leaves the public catalog, new contracts and the operation. It is
    /// refused with <c>service_in_active_contract</c> while a contract in force or in approval uses it, as a
    /// rate or inside a package. The Idempotency-Key and <c>expectedVersion</c> are required.
    /// </summary>
    [HttpPost("{id:guid}/retirement", Name = "RetireCommercialService")]
    [Consumes("application/json")]
    [ProducesResponseType<ManagedServiceData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> Retire(Guid id,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] RetireServiceInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.RetireAsync(actorId, id, idempotencyKey, input, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value, result.Code);
        await InvalidatePublicCatalogAsync();
        return Ok(result.Service);
    }

    /// <summary>Deprecated alias of the retirement without a reason; the same checks apply.</summary>
    [Obsolete("Retire the service with POST {id}/retirement and a reason.")]
    [HttpDelete("{id:guid}", Name = "DeleteCommercialService")]
    [ProducesResponseType<ManagedServiceData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Delete(Guid id, [FromQuery] string? version,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.DeleteAsync(actorId, id, version, idempotencyKey, cancellationToken);
        if (result.Failure is not null) return Failure(result.Failure.Value, result.Code);
        await InvalidatePublicCatalogAsync();
        return Ok(result.Service);
    }

    private Task InvalidatePublicCatalogAsync() => PublicCatalogInvalidation.TrySendAsync(
        token => hub.Clients.All.SendAsync("CatalogChangedV1", token), logger);

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    // Every failure carries a code; the clients explain the code, never the title.
    private IActionResult Failure(CatalogMutationFailure failure, string? code) => failure switch
    {
        CatalogMutationFailure.Forbidden => Forbid(),
        CatalogMutationFailure.Invalid => Coded(400, "Los datos del servicio no son válidos.", code ?? "invalid_service"),
        CatalogMutationFailure.NotFound => Coded(404, "El servicio ya no existe.", code ?? "not_found"),
        CatalogMutationFailure.Conflict => Coded(409, "El servicio cambió o su estado no admite el cambio.",
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
