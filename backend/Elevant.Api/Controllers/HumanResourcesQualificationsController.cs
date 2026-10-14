using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Governance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources/qualifications")]
public sealed class HumanResourcesQualificationsController(
    IHumanResourcesQualificationReadStore store,
    IHumanResourcesQualificationWriteStore writeStore) : ControllerBase
{
    [HttpGet(Name = "ListHumanResourcesQualifications")]
    [ProducesResponseType<HumanResourcesQualificationPage>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] int page = 1,
        [FromQuery] int limit = 50, [FromQuery] Guid? rampProfileId = null,
        [FromQuery] Guid? equipmentTypeId = null, [FromQuery] string? search = null,
        [FromQuery] string? validity = null, [FromQuery] DateOnly? asOf = null,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400, title: "Invalid paging parameters.");
        if (!TryQuery(rampProfileId, equipmentTypeId, search, validity, asOf, out var query))
            return Problem(statusCode: 400, title: "Invalid qualification filter.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.ListCurrentAsync(actorId, page, limit, query, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpGet("summary", Name = "SummarizeHumanResourcesQualifications")]
    [ProducesResponseType<HumanResourcesDocumentSummary>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> Summary([FromQuery] Guid? equipmentTypeId = null,
        [FromQuery] string? search = null, [FromQuery] DateOnly? asOf = null,
        CancellationToken cancellationToken = default)
    {
        if (!TryQuery(null, equipmentTypeId, search, null, asOf, out var query))
            return Problem(statusCode: 400, title: "Invalid qualification filter.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.SummarizeAsync(actorId, query, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpGet("{id:guid}/history", Name = "GetHumanResourcesQualificationHistory")]
    [ProducesResponseType<HumanResourcesQualificationHistory>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> History(Guid id, CancellationToken cancellationToken)
    {
        if (id == Guid.Empty) return Problem(statusCode: 400, title: "Invalid qualification identifier.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.GetHistoryAsync(actorId, id, cancellationToken);
        if (result.Forbidden) return Forbid();
        return result.Value is null
            ? Problem(statusCode: 404, title: "Qualification not found.")
            : Ok(result.Value);
    }

    private static bool TryQuery(Guid? rampProfileId, Guid? equipmentTypeId, string? search,
        string? validity, DateOnly? asOf, out HumanResourcesQualificationQuery query)
    {
        query = null!;
        if (rampProfileId == Guid.Empty || equipmentTypeId == Guid.Empty ||
            search?.Length > 100) return false;
        DocumentValidity? parsed = null;
        if (validity is not null)
        {
            if (!DocumentValidityRules.TryParse(validity, out var value)) return false;
            parsed = value;
        }
        query = new HumanResourcesQualificationQuery(
            asOf ?? DateOnly.FromDateTime(DateTime.UtcNow), search, rampProfileId,
            equipmentTypeId, parsed);
        return true;
    }

    [HttpGet("equipment-types", Name = "ListHumanResourcesQualificationEquipmentTypes")]
    [ProducesResponseType<IReadOnlyList<HumanResourcesQualificationEquipmentType>>(
        StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> EquipmentTypes(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await store.ListEquipmentTypesAsync(actorId, cancellationToken);
        return result is null ? Forbid() : Ok(result);
    }

    [HttpPut("{id:guid}", Name = "RecordHumanResourcesQualification")]
    [RequestSizeLimit(32768)]
    [ProducesResponseType<HumanResourcesQualificationRecorded>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Record(Guid id,
        [FromBody] RecordHumanResourcesQualificationInput input,
        CancellationToken cancellationToken)
    {
        if (id == Guid.Empty) return Problem(statusCode: 400, title: "Invalid qualification identifier.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId) ||
            actorId == Guid.Empty) return Unauthorized();
        var result = await writeStore.RecordAsync(actorId, id, input, cancellationToken);
        return result.Failure switch
        {
            null => Ok(result.Qualification),
            HumanResourcesQualificationWriteFailure.Forbidden => Forbid(),
            HumanResourcesQualificationWriteFailure.Invalid => Problem(statusCode: 400,
                title: "Invalid qualification record."),
            HumanResourcesQualificationWriteFailure.NotFound => Problem(statusCode: 404,
                title: "Ramp profile or equipment type not found."),
            HumanResourcesQualificationWriteFailure.Conflict => Problem(statusCode: 409,
                title: "Qualification conflicts with current state."),
            _ => throw new InvalidOperationException(),
        };
    }
}
