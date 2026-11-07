using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Contracts.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Preliminary, station-scoped warnings from confirmed shifts.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources/schedule-warnings")]
public sealed class HumanResourcesScheduleWarningsController(
    IHumanResourcesScheduleWarningStore store) : ControllerBase
{
    [HttpGet(Name = "ListHumanResourcesScheduleWarnings")]
    [ProducesResponseType<HumanResourcesScheduleWarningPageResponse>(
        StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden,
        "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound,
        "application/problem+json")]
    public async Task<IActionResult> List([FromQuery] Guid? stationId,
        [FromQuery(Name = "from")] DateOnly? from,
        [FromQuery(Name = "to")] DateOnly? to,
        [FromQuery] int page = 1, [FromQuery] int limit = 20,
        [FromQuery] bool includeReadiness = false,
        CancellationToken cancellationToken = default)
    {
        if (stationId is null || stationId == Guid.Empty ||
            from is null || to is null || from > to ||
            to.Value.DayNumber - from.Value.DayNumber >= 30 ||
            page < 1 || limit is < 1 or > 100 ||
            (long)(page - 1) * limit > int.MaxValue)
            return Problem(statusCode: 400, title: "Invalid schedule warning query.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub),
                out var actorId) || actorId == Guid.Empty)
            return Unauthorized();

        // 2-N24: only a client that asks for them receives the ApprovedAbsence and DocumentExpired kinds.
        var result = await store.ListAsync(actorId, stationId.Value,
            from.Value, to.Value, page, limit, includeReadiness, cancellationToken);
        if (result.Failure is { } failure)
            return failure switch
            {
                ScheduleWarningFailure.ForbiddenRole => Problem(statusCode: 403,
                    title: "Human resources warning access is forbidden."),
                ScheduleWarningFailure.ForbiddenStation => Problem(statusCode: 404,
                    title: "The station was not found."),
                _ => throw new InvalidOperationException(
                    "Unknown schedule warning access failure."),
            };

        var data = result.Page!;
        return Ok(new HumanResourcesScheduleWarningPageResponse(data.StationId,
            data.From, data.To, data.Page, data.Limit, data.HasMore,
            data.AsOf, data.RuleVersion, data.RuleEffectiveOn,
            data.Warnings.Select(item => new HumanResourcesScheduleWarningResponse(
                item.AnchorShiftId, item.RampProfileId, item.AgentName,
                item.EmployeeNumber, item.WorkDate, item.Kind.ToString(),
                item.Evidence.Select(evidence =>
                    new HumanResourcesScheduleWarningEvidenceResponse(
                        evidence.ShiftId, evidence.StationId,
                        evidence.StationCode, evidence.StartsAt,
                        evidence.EndsAt)).ToArray(),
                item.HasRestrictedEvidence, item.MeasuredMinutes,
                item.ThresholdMinutes, item.RuleVersion,
                item.RuleEffectiveOn, item.Reason)).ToArray()));
    }
}
