using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController, ApiVersion("1.0"), Authorize, PrivateResponse]
[Route("api/v{version:apiVersion}/chat/presence")]
public sealed class OperationalPresenceController(OperationalPresenceHandler handler) : ControllerBase
{
    [HttpPut(Name = "PutOperationalPresence")]
    [RequestSizeLimit(2048)]
    [ProducesResponseType(204)]
    [ProducesResponseType<ProblemDetails>(400)]
    [ProducesResponseType<ProblemDetails>(401)]
    [ProducesResponseType<ProblemDetails>(403)]
    [ProducesResponseType<ProblemDetails>(404)]
    public async Task<IActionResult> Put([FromBody] PresenceHeartbeatRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var account)) return Failure(OperationalCommunicationFailure.Unauthorized);
        var result = await handler.HeartbeatAsync(account,
            new PresenceHeartbeat(request.ClientId, request.Sequence, request.Mode, request.ActivityObserved), cancellationToken);
        return result.IsSuccess ? NoContent() : Failure(result.Failure!.Value);
    }

    [HttpGet("status", Name = "GetOwnOperationalPresence")]
    [ProducesResponseType<OwnPresenceResponse>(200)]
    [ProducesResponseType<ProblemDetails>(401)]
    [ProducesResponseType<ProblemDetails>(403)]
    [ProducesResponseType<ProblemDetails>(404)]
    public async Task<IActionResult> GetStatus(CancellationToken cancellationToken)
    {
        if (!TryAccount(out var account)) return Failure(OperationalCommunicationFailure.Unauthorized);
        var result = await handler.ReadOwnAsync(account, cancellationToken);
        return result.IsSuccess ? Ok(Own(result.Value!)) : Failure(result.Failure!.Value);
    }

    [HttpPut("status", Name = "PutOwnOperationalPresenceStatus")]
    [RequestSizeLimit(2048)]
    [ProducesResponseType<OwnPresenceResponse>(200)]
    [ProducesResponseType<ProblemDetails>(400)]
    [ProducesResponseType<ProblemDetails>(401)]
    [ProducesResponseType<ProblemDetails>(403)]
    [ProducesResponseType<ProblemDetails>(404)]
    public async Task<IActionResult> PutStatus([FromBody] PresenceStatusRequest request, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var account)) return Failure(OperationalCommunicationFailure.Unauthorized);
        var result = await handler.SetStatusAsync(account, new PresenceStatusUpdate(request.Availability, request.Message), cancellationToken);
        return result.IsSuccess ? Ok(Own(result.Value!)) : Failure(result.Failure!.Value);
    }

    [HttpGet(Name = "GetOperationalPresence")]
    [ProducesResponseType<OperationPresenceListResponse>(200)]
    [ProducesResponseType<ProblemDetails>(400)]
    [ProducesResponseType<ProblemDetails>(401)]
    [ProducesResponseType<ProblemDetails>(403)]
    [ProducesResponseType<ProblemDetails>(404)]
    public async Task<IActionResult> Get([FromQuery] Guid[] operationIds, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var account)) return Failure(OperationalCommunicationFailure.Unauthorized);
        var result = await handler.ReadAsync(account, operationIds, cancellationToken);
        return result.IsSuccess ? Ok(new OperationPresenceListResponse(result.Value!.AsOf,
            result.Value.Operations.Select(operation => new OperationPresenceResponse(operation.OperationId,
                operation.Participants.Select(person => new ParticipantPresenceResponse(
                    person.AccountId, person.Name, person.Role, person.State, person.LastActivityAt,
                    person.Availability, person.Message)).ToArray())).ToArray()))
            : Failure(result.Failure!.Value);
    }

    private static OwnPresenceResponse Own(OwnPresence value) => new(value.State, value.Availability, value.Message);

    private bool TryAccount(out Guid account) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out account) && account != Guid.Empty;

    private ObjectResult Failure(OperationalCommunicationFailure failure)
    {
        var status = failure switch
        {
            OperationalCommunicationFailure.Unauthorized => 401,
            OperationalCommunicationFailure.Forbidden => 403,
            OperationalCommunicationFailure.NotFound => 404,
            _ => 400,
        };
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails { Status = status,
            Title = "Presence is not available for this request.", Instance = HttpContext.Request.Path }) { StatusCode = status };
    }
}
