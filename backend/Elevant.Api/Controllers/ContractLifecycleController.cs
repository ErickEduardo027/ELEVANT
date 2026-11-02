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

    [HttpPost("airline/permits", Name = "SubmitAirlinePermit")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<AirlinePermitData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Submit([FromBody, BindRequired] SubmitAirlinePermitInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await permits.SubmitAsync(actorId, input, cancellationToken);
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

    [HttpPost("contracts/permits/{permitId:guid}/review", Name = "ReviewAirlinePermit")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<AirlinePermitData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Review(Guid permitId, [FromBody, BindRequired] ReviewAirlinePermitInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await permits.ReviewAsync(actorId, permitId, input, cancellationToken);
        return result.Failure is { } failure ? PermitFailure(failure, result.Code) : Ok(result.Permit);
    }

    [HttpGet("contract-versions/{versionId:guid}/timeline", Name = "GetContractTimeline")]
    [ProducesResponseType<ContractTimelineData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Timeline(Guid versionId, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var timeline = await lifecycle.TimelineAsync(actorId, versionId, cancellationToken);
        return timeline is null ? Problem(statusCode: 404, title: "Contract not found.") : Ok(timeline);
    }

    [HttpPost("contract-versions/{versionId:guid}/lifecycle", Name = "ApplyContractLifecycle")]
    [RequestSizeLimit(4096)]
    [ProducesResponseType<ContractLifecycleResult>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Apply(Guid versionId, [FromBody, BindRequired] ContractLifecycleInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await lifecycle.ApplyAsync(actorId, versionId, input, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result),
            ContractLifecycleFailure.Forbidden => Forbid(),
            ContractLifecycleFailure.NotFound => Problem(statusCode: 404, title: "Contract not found."),
            ContractLifecycleFailure.Conflict => Coded(409, "The contract changed; reload and retry.", result.Code),
            _ => Coded(400, "Invalid lifecycle action.", result.Code),
        };
    }

    private IActionResult PermitFailure(AirlinePermitFailure failure, string? code) => failure switch
    {
        AirlinePermitFailure.Forbidden => Forbid(),
        AirlinePermitFailure.NotFound => Problem(statusCode: 404, title: "Permit not found."),
        AirlinePermitFailure.Conflict => Coded(409, "The permit changed; reload and retry.", code),
        _ => Coded(400, "Invalid permit.", code),
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
