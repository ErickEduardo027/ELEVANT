using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources/permits")]
public sealed class HumanResourcesPermitsController(
    IHumanResourcesPermitReadStore store,
    IHumanResourcesPermitWriteStore writeStore) : ControllerBase
{
    [HttpGet(Name = "ListHumanResourcesPermits")]
    [ProducesResponseType<HumanResourcesPermitPage>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] int page = 1,
        [FromQuery] int limit = 50, [FromQuery] Guid? rampProfileId = null,
        [FromQuery] string? documentType = null, [FromQuery] string? search = null,
        [FromQuery] string? validity = null, [FromQuery] DateOnly? asOf = null,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400, title: "Invalid paging parameters.");
        if (!TryQuery(rampProfileId, documentType, search, validity, asOf, out var query))
            return Problem(statusCode: 400, title: "Invalid permit filter.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.ListCurrentAsync(actorId, page, limit, query, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpGet("summary", Name = "SummarizeHumanResourcesPermits")]
    [ProducesResponseType<HumanResourcesDocumentSummary>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Summary([FromQuery] string? documentType = null,
        [FromQuery] string? search = null, [FromQuery] DateOnly? asOf = null,
        CancellationToken cancellationToken = default)
    {
        if (!TryQuery(null, documentType, search, null, asOf, out var query))
            return Problem(statusCode: 400, title: "Invalid permit filter.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.SummarizeAsync(actorId, query, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpGet("{id:guid}/history", Name = "GetHumanResourcesPermitHistory")]
    [ProducesResponseType<HumanResourcesPermitHistory>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> History(Guid id, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty) return Problem(statusCode: 400, title: "Invalid permit identifier.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.GetHistoryAsync(actorId, id, cancellationToken);
        if (result.Forbidden) return Forbid();
        return result.Value is null
            ? Problem(statusCode: 404, title: "Permit not found.")
            : Ok(result.Value);
    }

    private static bool TryQuery(Guid? rampProfileId, string? documentType, string? search,
        string? validity, DateOnly? asOf, out HumanResourcesPermitQuery query)
    {
        query = null!;
        if (rampProfileId == Guid.Empty || search?.Length > 100) return false;
        PermitDocumentType? type = null;
        if (documentType is not null)
        {
            if (documentType is not (nameof(PermitDocumentType.AirportId) or
                nameof(PermitDocumentType.RampDriverLicense))) return false;
            type = Enum.Parse<PermitDocumentType>(documentType);
        }
        DocumentValidity? parsed = null;
        if (validity is not null)
        {
            if (!DocumentValidityRules.TryParse(validity, out var value)) return false;
            parsed = value;
        }
        query = new HumanResourcesPermitQuery(asOf ?? DateOnly.FromDateTime(DateTime.UtcNow),
            search, rampProfileId, type, parsed);
        return true;
    }

    [HttpPut("{id:guid}", Name = "RecordHumanResourcesPermit")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<HumanResourcesPermitRecorded>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Record(Guid id,
        [FromBody] RecordHumanResourcesPermitInput input,
        CancellationToken cancellationToken)
    {
        if (id == Guid.Empty) return Problem(statusCode: 400, title: "Invalid permit identifier.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.RecordAsync(actorId, id, input, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result.Permit),
            HumanResourcesPermitWriteFailure.Forbidden => Forbid(),
            HumanResourcesPermitWriteFailure.Invalid => Problem(statusCode: 400,
                title: "Invalid permit record."),
            HumanResourcesPermitWriteFailure.NotFound => Problem(statusCode: 404,
                title: "Ramp profile not found."),
            HumanResourcesPermitWriteFailure.Conflict => Problem(statusCode: 409,
                title: "Permit conflicts with current state."),
            _ => throw new InvalidOperationException(),
        };
    }
}
