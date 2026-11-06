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
    string? Version);
public sealed record ReopenServiceRequest(string? Reason, string? ServiceVersion);

/// <summary>
/// OCC reports that a service cannot be performed, Contratos decides with four eyes and republishes
/// it with a reason. Approval works on a service that is already hidden or retired; a retired service
/// is reactivated in the catalog before it is republished (1-N11). Every failure carries a code.
/// </summary>
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
            return Coded(400, "El filtro no es válido.", "invalid_closure_query");
        var result = await store.ListAsync(actorId, status, page, limit,
            cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpPost(Name = "CreateServiceClosure")]
    [ProducesResponseType<ServiceClosureData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Create([FromBody] CreateServiceClosureRequest input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.RequestAsync(actorId, input.RequestId,
            input.ServiceId, input.Reason, cancellationToken);
        return result.Failure is { } failure ? Failure(failure, result.Code) :
            StatusCode(201, result.Request);
    }

    /// <summary>
    /// Approves or denies a pending request. The Idempotency-Key is optional while older clients exist
    /// (expand); <c>version</c> is the request rowversion on screen.
    /// </summary>
    [HttpPost("{id:guid}/decision", Name = "DecideServiceClosure")]
    [ProducesResponseType<ServiceClosureData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Decide(Guid id,
        [FromBody] DecideServiceClosureRequest input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.DecideAsync(actorId, id, input.Approve,
            input.Reason, input.Version, idempotencyKey, cancellationToken);
        if (result.Failure is { } failure) return Failure(failure, result.Code);
        if (input.Approve) await BroadcastCatalogChangeAsync();
        return Ok(result.Request);
    }

    /// <summary>
    /// Republishes a service its approved closure hid, with a reason; a retired service answers
    /// <c>service_retired</c> until it is reactivated. The Idempotency-Key is optional while older
    /// clients exist (expand); <c>serviceVersion</c> is the service rowversion on screen.
    /// </summary>
    [HttpPost("services/{id:guid}/reopen", Name = "ReopenService")]
    [ProducesResponseType<ServiceClosureData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Reopen(Guid id, [FromBody] ReopenServiceRequest input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.ReopenAsync(actorId, id, input.Reason,
            input.ServiceVersion, idempotencyKey, cancellationToken);
        if (result.Failure is { } failure) return Failure(failure, result.Code);
        await BroadcastCatalogChangeAsync();
        return Ok(result.Request);
    }

    private Task BroadcastCatalogChangeAsync() =>
        PublicCatalogInvalidation.TrySendAsync(
            token => hub.Clients.All.SendAsync("CatalogChangedV1", token), logger);

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    // Every failure carries a code; the clients explain the code, never the title.
    private IActionResult Failure(ServiceClosureFailure failure, string? code) => failure switch
    {
        ServiceClosureFailure.Forbidden when code is not null =>
            Coded(403, "No puede decidir esta solicitud de clausura.", code),
        ServiceClosureFailure.Forbidden => Forbid(),
        ServiceClosureFailure.Invalid => Coded(400, "Los datos de la clausura no son válidos.", code ?? "invalid_closure"),
        ServiceClosureFailure.NotFound => Coded(404, "El servicio o la solicitud ya no existe.", code ?? "not_found"),
        ServiceClosureFailure.Conflict => Coded(409, "El servicio o la solicitud cambió; actualice e intente de nuevo.",
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
