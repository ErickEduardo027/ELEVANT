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

/// <summary>Reads and saves separate manual OCC and assigned-agent attendance observations.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/operations/{operationId:guid}/assignments/{assignmentId:guid}/attendance-draft")]
public sealed class AttendanceDraftController(IAttendanceDraftStore store) : ControllerBase
{
    private const long BodyLimitBytes = 16 * 1024;

    /// <summary>Returns the current revision in each lane, rechecking live access.</summary>
    [HttpGet(Name = "GetOperationAttendanceDraft")]
    [ProducesResponseType<AttendanceDraftSnapshotResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<AttendanceDraftSnapshotResponse>> Get(
        [FromRoute] Guid operationId,
        [FromRoute] Guid assignmentId,
        [FromHeader(Name = "X-Elevant-Installation-Id")] Guid? installationId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return UnauthorizedResult<AttendanceDraftSnapshotResponse>();
        var result = await store.GetAsync(accountId, operationId, assignmentId,
            installationId, cancellationToken);
        if (!result.IsSuccess)
            return FailureResult<AttendanceDraftSnapshotResponse>(result.Failure!.Value);
        var snapshot = result.Snapshot!;
        return Ok(new AttendanceDraftSnapshotResponse(snapshot.OperationId,
            snapshot.AssignmentId, snapshot.StationId,
            snapshot.Occ is null ? null : Map(snapshot.Occ),
            snapshot.RampAgent is null ? null : Map(snapshot.RampAgent)));
    }

    /// <summary>Appends only the current OCC user's lane revision.</summary>
    [HttpPut("occ", Name = "SaveOccAttendanceDraft")]
    [Consumes("application/json")]
    [RequestSizeLimit(BodyLimitBytes)]
    [ProducesResponseType<AttendanceDraftWriteResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(413, "application/problem+json")]
    public Task<ActionResult<AttendanceDraftWriteResponse>> SaveOcc(
        [FromRoute] Guid operationId,
        [FromRoute] Guid assignmentId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] SaveAttendanceDraftRequest request,
        CancellationToken cancellationToken) =>
        SaveAsync(operationId, assignmentId, AttendanceDraftLane.Occ,
            idempotencyKey, null, request, cancellationToken);

    /// <summary>Appends only the active assigned agent's lane revision.</summary>
    [HttpPut("ramp-agent", Name = "SaveRampAttendanceDraft")]
    [Consumes("application/json")]
    [RequestSizeLimit(BodyLimitBytes)]
    [ProducesResponseType<AttendanceDraftWriteResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(413, "application/problem+json")]
    public Task<ActionResult<AttendanceDraftWriteResponse>> SaveRampAgent(
        [FromRoute] Guid operationId,
        [FromRoute] Guid assignmentId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromBody, BindRequired] SaveAttendanceDraftRequest request,
        CancellationToken cancellationToken) =>
        SaveAsync(operationId, assignmentId, AttendanceDraftLane.RampAgent,
            idempotencyKey, installationId, request, cancellationToken);

    private async Task<ActionResult<AttendanceDraftWriteResponse>> SaveAsync(
        Guid operationId, Guid assignmentId, AttendanceDraftLane lane,
        Guid idempotencyKey, Guid? installationId,
        SaveAttendanceDraftRequest request, CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
            return UnauthorizedResult<AttendanceDraftWriteResponse>();
        if (Request.ContentLength > BodyLimitBytes)
            return ProblemResult<AttendanceDraftWriteResponse>(413, "The attendance draft is too large.");
        if (idempotencyKey == Guid.Empty ||
            installationId == Guid.Empty ||
            !AttendanceDraftPolicy.IsValid(request.ExpectedRevision,
                request.ObservedStartAt, request.ObservedEndAt, request.IncidentNote))
            return ProblemResult<AttendanceDraftWriteResponse>(400, "The attendance draft is invalid.");

        var result = await store.SaveAsync(new AttendanceDraftWriteRequest(
            accountId, operationId, assignmentId, lane, request.ExpectedRevision,
            request.ObservedStartAt, request.ObservedEndAt, request.IncidentNote,
            idempotencyKey, installationId, HttpContext.TraceIdentifier),
            cancellationToken);
        if (!result.IsSuccess)
            return FailureResult<AttendanceDraftWriteResponse>(result.Failure!.Value);
        return Ok(new AttendanceDraftWriteResponse(Map(result.Contribution!), result.Replayed));
    }

    private static AttendanceDraftContributionResponse Map(
        AttendanceDraftContributionData value) => new(value.Revision,
            value.AuthorAccountId, value.RecordedAt, value.ObservedStartAt,
            value.ObservedEndAt, value.IncidentNote);

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> FailureResult<T>(AttendanceDraftFailure failure) => failure switch
    {
        AttendanceDraftFailure.Invalid => ProblemResult<T>(400, "The attendance draft is invalid."),
        AttendanceDraftFailure.Unauthorized => UnauthorizedResult<T>(),
        AttendanceDraftFailure.Forbidden => ProblemResult<T>(403, "Attendance draft access is forbidden."),
        AttendanceDraftFailure.NotFound => ProblemResult<T>(404, "The assignment was not found."),
        AttendanceDraftFailure.Conflict => ProblemResult<T>(409, "The attendance draft conflicts with the current revision."),
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
