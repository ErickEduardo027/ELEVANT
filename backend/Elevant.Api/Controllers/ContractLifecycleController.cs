using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Airline permit dossier and the chronological contract lifecycle (ADR-0024): the airline
/// submits permits from its portal, Contratos verifies them and suspends, reactivates, terminates
/// or renews contracts; both read the merged timeline.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}")]
public sealed class ContractLifecycleController(IAirlinePermitStore permits, IContractLifecycleStore lifecycle)
    : ControllerBase
{
    [HttpGet("airline/permits", Name = "GetAirlinePermits")]
    [ProducesResponseType<AirlinePermitData[]>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> AirlinePermits(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var rows = await permits.ListForAirlineAsync(actorId, cancellationToken);
        return rows is null ? Forbid() : Ok(rows);
    }

    /// <summary>
    /// The airline submits a permit of its dossier. The Idempotency-Key is optional while older portals exist
    /// (expand, 2-N09); with it a retry answers the permit the first attempt created. A scan uploaded before
    /// the media link window answers <c>document_expired</c> and must be uploaded again (2-N37).
    /// </summary>
    [HttpPost("airline/permits", Name = "SubmitAirlinePermit")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<AirlinePermitData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Submit([FromBody, BindRequired] SubmitAirlinePermitInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await permits.SubmitAsync(actorId, input, idempotencyKey, cancellationToken);
        return result.Failure is { } failure ? PermitFailure(failure, result.Code) : StatusCode(201, result.Permit);
    }

    [HttpGet("contracts/permits", Name = "GetContractsAirlinePermits")]
    [ProducesResponseType<AirlinePermitData[]>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> ContractsPermits([FromQuery] string? review, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var rows = await permits.ListForContractsAsync(actorId, review, cancellationToken);
        return rows is null ? Forbid() : Ok(rows);
    }

    /// <summary>
    /// Contratos verifies or rejects a submitted permit with the version it saw; any other permit answers 409
    /// <c>review_closed</c> (2-N09). The answer adds the contracts the review activated or resumed (2-N30). The
    /// Idempotency-Key is optional while older clients exist (expand).
    /// </summary>
    [HttpPost("contracts/permits/{permitId:guid}/review", Name = "ReviewAirlinePermit")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<AirlinePermitDecisionData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Review(Guid permitId, [FromBody, BindRequired] ReviewAirlinePermitInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await permits.ReviewAsync(actorId, permitId, input, idempotencyKey, cancellationToken);
        return result.Failure is { } failure ? PermitFailure(failure, result.Code) : Ok(result.Permit);
    }

    /// <summary>
    /// Contratos revokes a verified permit with a reason and the version it saw (2-N09). The permit becomes
    /// Revoked and keeps its original verification; the active contracts left without a usable operating
    /// permit are suspended in the same transaction and the airline is emailed. The answer names them.
    /// </summary>
    [HttpPost("contracts/permits/{permitId:guid}/revocation", Name = "RevokeAirlinePermit")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<AirlinePermitDecisionData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Revoke(Guid permitId, [FromBody, BindRequired] RevokeAirlinePermitInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await permits.RevokeAsync(actorId, permitId, input, idempotencyKey, cancellationToken);
        return result.Failure is { } failure ? PermitFailure(failure, result.Code) : Ok(result.Permit);
    }

    /// <summary>
    /// History of the contract. The airline reads its own contracts without internal names or the
    /// internal reason of a Finance return (1-N05).
    /// </summary>
    [HttpGet("contract-versions/{versionId:guid}/timeline", Name = "GetContractTimeline")]
    [ProducesResponseType<ContractTimelineData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Timeline(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var timeline = await lifecycle.TimelineAsync(actorId, versionId, cancellationToken);
        return timeline is null ? Coded(404, "El contrato ya no existe.", "not_found") : Ok(timeline);
    }

    /// <summary>
    /// Suspend, reactivate, terminate (also «Descartar contrato» for one that never activated), cancel a
    /// scheduled termination or renew, with a reason and the status the user saw. A termination of an
    /// active or suspended contract takes <c>effectiveOn</c> (at least today plus the signed notice) or an
    /// <c>immediateCause</c> (<c>Breach</c> or <c>MutualAgreement</c>, 2-N14). The Idempotency-Key is
    /// optional while older clients exist (expand); with it a retry replays the first result.
    /// </summary>
    [HttpPost("contract-versions/{versionId:guid}/lifecycle", Name = "ApplyContractLifecycle")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<ContractLifecycleResult>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Apply(Guid versionId, [FromBody, BindRequired] ContractLifecycleInput input,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await lifecycle.ApplyAsync(actorId, versionId, input, idempotencyKey, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result),
            ContractLifecycleFailure.Forbidden => Forbid(),
            ContractLifecycleFailure.NotFound => Coded(404, "El contrato ya no existe.", result.Code ?? "not_found"),
            ContractLifecycleFailure.Conflict => Coded(409, "El contrato cambió; vuelva a cargarlo.",
                result.Code ?? "status_changed"),
            _ => Coded(400, "La acción sobre el contrato no es válida.", result.Code ?? "invalid_lifecycle_action"),
        };
    }

    /// <summary>Every permit failure carries a stable code and a Spanish title (phase 2, block B).</summary>
    private IActionResult PermitFailure(AirlinePermitFailure failure, string? code) => failure switch
    {
        AirlinePermitFailure.Forbidden => code == "signer_required"
            ? Coded(403, "Solo un representante o un firmante de la aerolínea envía el permiso.", code)
            : Coded(403, "No tiene permiso para esta acción.", code ?? "forbidden"),
        AirlinePermitFailure.NotFound => Coded(404, "El permiso ya no existe.", code ?? "not_found"),
        AirlinePermitFailure.Conflict => Coded(409, "El permiso cambió; vuelva a cargarlo.", code ?? "version_conflict"),
        _ => Coded(400, "Los datos del permiso no son válidos.", code ?? "invalid_permit"),
    };

    private ObjectResult Coded(int status, string title, string? code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        if (code is not null) problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;
}
