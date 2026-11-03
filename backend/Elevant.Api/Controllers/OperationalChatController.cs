using System.Security.Claims;
using System.ComponentModel.DataAnnotations;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Operation-scoped, durable text channel shared by OCC and assigned ramp agents.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/chat/conversations")]
public sealed class OperationalChatController(OperationalCommunicationHandler handler) : ControllerBase
{
    [HttpGet(Name = "GetOperationalConversations")]
    [ProducesResponseType<OperationConversationListResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<OperationConversationListResponse>> GetConversations(
        [FromQuery] Guid? stationId, [FromQuery, Range(0, int.MaxValue)] int offset = 0, CancellationToken cancellationToken = default)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OperationConversationListResponse>();
        var result = await handler.GetConversationsAsync(accountId, stationId, offset, cancellationToken);
        return result.IsSuccess
            ? Ok(new OperationConversationListResponse(
                result.Value!.Conversations.Select(item => new OperationConversationResponse(
                    item.OperationId, item.OperationCode, item.OperationDate,
                    item.StationCode, item.AirlineName, item.AgentName,
                    item.Status, item.LastMessage is null ? null : Map(item.LastMessage))).ToArray(),
                result.Value.HasMore))
            : FailureResult<OperationConversationListResponse>(result.Failure!.Value);
    }

    [HttpGet("{operationId:guid}/messages", Name = "GetOperationalMessages")]
    [ProducesResponseType<OperationMessageListResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    public async Task<ActionResult<OperationMessageListResponse>> GetMessages(
        [FromRoute] Guid operationId, [FromQuery, Range(0, int.MaxValue)] int offset = 0, CancellationToken cancellationToken = default)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OperationMessageListResponse>();
        var result = await handler.GetMessagesAsync(accountId, operationId, offset, cancellationToken);
        return result.IsSuccess
            ? Ok(new OperationMessageListResponse(operationId,
                result.Value!.Messages.Select(Map).ToArray(), result.Value.HasMore))
            : FailureResult<OperationMessageListResponse>(result.Failure!.Value);
    }

    [RequestSizeLimit(8 * 1024)]
    [HttpPost("{operationId:guid}/messages", Name = "SendOperationalMessage")]
    [Consumes("application/json")]
    [ProducesResponseType<OperationMessageResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<OperationMessageResponse>> SendMessage(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid clientMessageId,
        [FromHeader(Name = "X-Elevant-Installation-Id")] Guid? installationId,
        [FromBody, BindRequired] SendOperationMessageRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccountId(out var accountId)) return UnauthorizedResult<OperationMessageResponse>();
        var result = await handler.SendMessageAsync(accountId, operationId,
            clientMessageId, installationId, request.Content, cancellationToken);
        return result.IsSuccess
            ? Ok(Map(result.Value!))
            : FailureResult<OperationMessageResponse>(result.Failure!.Value);
    }

    private static OperationMessageResponse Map(OperationMessageData item) => new(
        item.Id, item.OperationId, item.SenderAccountId, item.SenderRole,
        item.SenderName, item.Content, item.SentAt);

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
        OperationalCommunicationFailure.Forbidden => ProblemResult<T>(403, "Communication is forbidden."),
        OperationalCommunicationFailure.InvalidRequest => ProblemResult<T>(400, "The communication request is invalid."),
        OperationalCommunicationFailure.NotFound => ProblemResult<T>(404, "The conversation was not found."),
        OperationalCommunicationFailure.Conflict => ProblemResult<T>(409, "The message key conflicts with an existing message."),
        _ => throw new InvalidOperationException("Unsupported communication failure."),
    };

    private ActionResult<T> ProblemResult<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = status, Title = title, Instance = HttpContext.Request.Path,
        }) { StatusCode = status };
}
