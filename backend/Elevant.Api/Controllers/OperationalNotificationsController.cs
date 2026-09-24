using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Durable, account-owned operational alerts for OCC and ramp agents.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/notifications")]
public sealed class OperationalNotificationsController(
    OperationalCommunicationHandler handler) : ControllerBase
{
    [HttpGet(Name = "GetOperationalNotifications")]
    [ProducesResponseType<OperationalNotificationListResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<OperationalNotificationListResponse>> Get(
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OperationalNotificationListResponse>();
        var result = await handler.GetNotificationsAsync(accountId, cancellationToken);
        return result.IsSuccess
            ? Ok(new OperationalNotificationListResponse(
                result.Value!.Notifications.Select(Map).ToArray(), result.Value.HasMore))
            : FailureResult<OperationalNotificationListResponse>(result.Failure!.Value);
    }

    [RequestSizeLimit(1024)]
    [HttpPut("{notificationId:guid}/read", Name = "SetOperationalNotificationRead")]
    [Consumes("application/json")]
    [ProducesResponseType<OperationalNotificationResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OperationalNotificationResponse>> SetRead(
        [FromRoute] Guid notificationId,
        [FromBody, BindRequired] SetOperationalNotificationReadRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OperationalNotificationResponse>();
        var result = await handler.SetNotificationReadAsync(accountId, notificationId,
            request.Read, cancellationToken);
        return result.IsSuccess
            ? Ok(Map(result.Value!))
            : FailureResult<OperationalNotificationResponse>(result.Failure!.Value);
    }

    private static OperationalNotificationResponse Map(OperationalNotificationData item) => new(
        item.Id, item.OperationId, item.OperationCode, item.StationCode,
        item.Kind, item.SourceId, item.OccurredAt, item.ReadAt);

    private bool TryAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(401, "Authentication failed.");
    }

    private ActionResult<T> FailureResult<T>(OperationalCommunicationFailure failure) => failure switch
    {
        OperationalCommunicationFailure.Unauthorized => UnauthorizedResult<T>(),
        OperationalCommunicationFailure.Forbidden => ProblemResult<T>(403, "Notifications are forbidden."),
        OperationalCommunicationFailure.InvalidRequest => ProblemResult<T>(400, "The notification request is invalid."),
        OperationalCommunicationFailure.NotFound => ProblemResult<T>(404, "The notification was not found."),
        OperationalCommunicationFailure.Conflict => ProblemResult<T>(409, "The notification changed."),
        _ => throw new InvalidOperationException("Unsupported notification failure."),
    };

    private ActionResult<T> ProblemResult<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
        }) { StatusCode = status };
}
