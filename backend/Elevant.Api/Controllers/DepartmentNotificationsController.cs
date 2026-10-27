using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Identity;
using Elevant.Contracts.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>On-screen alerts for Human Resources, Contracts and Finance; the source is re-read through its own endpoint.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/department-notifications")]
public sealed class DepartmentNotificationsController(IDepartmentNotificationStore store) : ControllerBase
{
    [HttpGet(Name = "GetDepartmentNotifications")]
    [ProducesResponseType<DepartmentNotificationListResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<DepartmentNotificationListResponse>> Get(CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<DepartmentNotificationListResponse>();
        var result = await store.ListAsync(accountId, cancellationToken);
        return result.IsSuccess
            ? Ok(new DepartmentNotificationListResponse(result.Value!.Notifications.Select(Map).ToArray(),
                result.Value.UnreadCount, result.Value.HasMore))
            : FailureResult<DepartmentNotificationListResponse>(result.Failure!.Value);
    }

    [RequestSizeLimit(1024)]
    [HttpPut("{notificationId:guid}/read", Name = "SetDepartmentNotificationRead")]
    [Consumes("application/json")]
    [ProducesResponseType<DepartmentNotificationResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<DepartmentNotificationResponse>> SetRead([FromRoute] Guid notificationId,
        [FromBody, BindRequired] SetDepartmentNotificationReadRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<DepartmentNotificationResponse>();
        var result = await store.SetReadAsync(accountId, notificationId, request.Read, cancellationToken);
        return result.IsSuccess ? Ok(Map(result.Value!)) : FailureResult<DepartmentNotificationResponse>(result.Failure!.Value);
    }

    private static DepartmentNotificationResponse Map(DepartmentNotificationData item) => new(
        item.Id, item.Department, item.Kind, item.SourceId, item.Subject, item.StationCode, item.OccurredAt, item.ReadAt);

    private bool TryAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) && accountId != Guid.Empty;

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(401, "Authentication failed.");
    }

    private ActionResult<T> FailureResult<T>(DepartmentNotificationFailure failure) => failure switch
    {
        DepartmentNotificationFailure.Forbidden => ProblemResult<T>(403, "Notifications are forbidden."),
        DepartmentNotificationFailure.NotFound => ProblemResult<T>(404, "The notification was not found."),
        DepartmentNotificationFailure.Conflict => ProblemResult<T>(409, "The notification changed."),
        _ => throw new InvalidOperationException("Unsupported notification failure."),
    };

    private ActionResult<T> ProblemResult<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
}
