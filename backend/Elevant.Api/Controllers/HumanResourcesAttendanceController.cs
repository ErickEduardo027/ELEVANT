using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Reviews immutable OCC and ramp-agent attendance observations in G.H.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/human-resources/attendance")]
public sealed class HumanResourcesAttendanceController(IAttendanceValidationStore store)
    : ControllerBase
{
    private const long BodyLimitBytes = 8 * 1024;

    /// <summary>Lists the station's assignment evidence for an operation-date interval.</summary>
    [HttpGet(Name = "GetHumanResourcesAttendance")]
    [ProducesResponseType<HumanResourcesAttendancePageResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<HumanResourcesAttendancePageResponse>> List(
        [FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "from"), BindRequired] DateOnly startDate,
        [FromQuery(Name = "to"), BindRequired] DateOnly endDate,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (!TryGetAccountId(out var accountId))
            return UnauthorizedResult<HumanResourcesAttendancePageResponse>();
        if (stationId == Guid.Empty || startDate == default || endDate < startDate ||
            endDate.DayNumber - startDate.DayNumber >= 30 || page < 1 ||
            limit is < 1 or > 100 || (long)(page - 1) * limit > int.MaxValue)
            return ProblemResult<HumanResourcesAttendancePageResponse>(400,
                "The attendance query is invalid.");

        var result = await store.ListAsync(accountId, stationId, startDate, endDate,
            page, limit, cancellationToken);
        if (result is null)
            return ProblemResult<HumanResourcesAttendancePageResponse>(403,
                "Human resources access is forbidden.");
        return Ok(new HumanResourcesAttendancePageResponse(result.StationId,
            result.From, result.To, result.Page, result.Limit, result.HasMore,
            result.Items.Select(Map).ToArray()));
    }

    /// <summary>Appends an immutable, revision-bound G.H. validation decision.</summary>
    [HttpPut("{assignmentId:guid}/validation", Name = "ValidateHumanResourcesAttendance")]
    [Consumes("application/json")]
    [RequestSizeLimit(BodyLimitBytes)]
    [ProducesResponseType<AttendanceValidationWriteResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(413, "application/problem+json")]
    public async Task<ActionResult<AttendanceValidationWriteResponse>> Validate(
        [FromRoute] Guid assignmentId,
        [FromQuery, BindRequired] Guid stationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] ValidateAttendanceRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return UnauthorizedResult<AttendanceValidationWriteResponse>();
        if (Request.ContentLength > BodyLimitBytes)
            return ProblemResult<AttendanceValidationWriteResponse>(413,
                "The attendance validation is too large.");
        if (assignmentId == Guid.Empty || stationId == Guid.Empty ||
            idempotencyKey == Guid.Empty || request.ExpectedOccRevision < 1 ||
            request.ExpectedRampAgentRevision < 1 ||
            request.StartSource is not ("Occ" or "RampAgent") ||
            request.EndSource is not ("Occ" or "RampAgent") ||
            request.Reason?.Length > 1000)
            return ProblemResult<AttendanceValidationWriteResponse>(400,
                "The attendance validation is invalid.");

        var result = await store.ValidateAsync(new AttendanceValidationCommand(
            accountId, stationId, assignmentId, request.ExpectedOccRevision,
            request.ExpectedRampAgentRevision, request.StartSource,
            request.EndSource, request.Reason, idempotencyKey,
            HttpContext.TraceIdentifier), cancellationToken);
        if (result.Failure is AttendanceValidationFailure failure)
            return FailureResult(failure);
        return Ok(new AttendanceValidationWriteResponse(Map(result.Decision!), result.Replayed));
    }

    private static HumanResourcesAttendanceRowResponse Map(HumanResourcesAttendanceRow row) =>
        new(row.OperationId, row.AssignmentId, row.StationId, row.OperationDate,
            row.OperationCode, row.AgentName,
            row.Occ is null ? null : Map(row.Occ),
            row.RampAgent is null ? null : Map(row.RampAgent),
            row.LatestDecision is null ? null : Map(row.LatestDecision),
            row.IsDecisionCurrent);

    private static AttendanceDraftContributionResponse Map(
        AttendanceDraftContributionData value) => new(value.Revision,
            value.AuthorAccountId, value.RecordedAt, value.ObservedStartAt,
            value.ObservedEndAt, value.IncidentNote);

    private static AttendanceValidationDecisionResponse Map(
        AttendanceValidationDecisionData value) => new(value.Id,
            value.AssignmentId, value.OccRevision, value.RampAgentRevision,
            value.StartSource, value.EndSource, value.StartAt, value.EndAt,
            value.Reason, value.ValidatedByAccountId, value.ValidatedAt);

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<AttendanceValidationWriteResponse> FailureResult(
        AttendanceValidationFailure failure) => failure switch
        {
            AttendanceValidationFailure.Invalid => ProblemResult<AttendanceValidationWriteResponse>(
                400, "The attendance validation is invalid."),
            AttendanceValidationFailure.Unauthorized => UnauthorizedResult<AttendanceValidationWriteResponse>(),
            AttendanceValidationFailure.Forbidden => ProblemResult<AttendanceValidationWriteResponse>(
                403, "Human resources access is forbidden."),
            AttendanceValidationFailure.NotFound => ProblemResult<AttendanceValidationWriteResponse>(
                404, "The assignment was not found."),
            AttendanceValidationFailure.Conflict => ProblemResult<AttendanceValidationWriteResponse>(
                409, "The attendance observations changed; review the current revisions."),
            _ => throw new ArgumentOutOfRangeException(nameof(failure)),
        };

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(401, "Authentication failed.");
    }

    private ActionResult<T> ProblemResult<T>(int statusCode, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Instance = HttpContext.Request.Path,
        }) { StatusCode = statusCode };
}
