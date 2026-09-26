using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Api.Hubs;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/contracts/commercial-requests")]
public sealed class CommercialRequestsManagementController(
    ICommercialWorkflowStore store,
    IHubContext<PublicCatalogHub> publicCatalogHub) : ControllerBase
{
    [HttpGet(Name = "ListCommercialRequests")]
    [ProducesResponseType<CommercialRequestData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var requests = await store.ListRequestsAsync(actorId, cancellationToken);
        return requests is null ? Forbid() : Ok(requests);
    }

    [HttpGet("stations", Name = "ListCommercialStations")]
    [ProducesResponseType<CommercialStationData[]>(StatusCodes.Status200OK, "application/json")]
    public async Task<IActionResult> Stations(CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var stations = await store.ListStationsAsync(actorId, cancellationToken);
        return stations is null ? Forbid() : Ok(stations);
    }

    [HttpPut("airlines/{profileId:guid}/verification", Name = "VerifyCommercialAirline")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> VerifyAirline(Guid profileId,
        [FromBody] VerifyAirlineInput input, CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.VerifyAirlineAsync(actorId, profileId, input, cancellationToken);
        if (result.IsSuccess)
            await publicCatalogHub.Clients.All.SendAsync("CatalogChangedV1", cancellationToken);
        return result.Failure is null ? Ok(new CommercialIdResponse(result.ResourceId!.Value)) : Failure(result.Failure.Value);
    }

    [HttpPost("{id:guid}/decision", Name = "DecideCommercialRequest")]
    [ProducesResponseType<CommercialIdResponse>(StatusCodes.Status200OK, "application/json")]
    [RequestSizeLimit(16384)]
    public async Task<IActionResult> Decide(Guid id, [FromBody] ReviewCommercialInput input,
        CancellationToken cancellationToken)
    {
        if (!TryActor(out var actorId)) return Unauthorized();
        var result = await store.DecideAsync(actorId, id, input, cancellationToken);
        return result.Failure is null ? Ok(new CommercialIdResponse(result.ResourceId!.Value)) : Failure(result.Failure.Value);
    }

    private bool TryActor(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private IActionResult Failure(CommercialWorkflowFailure failure) => failure switch
    {
        CommercialWorkflowFailure.Forbidden => Forbid(),
        CommercialWorkflowFailure.NotFound => Problem(statusCode: 404, title: "Commercial record not found."),
        CommercialWorkflowFailure.Invalid => Problem(statusCode: 400, title: "Invalid commercial review data."),
        CommercialWorkflowFailure.Conflict => Problem(statusCode: 409, title: "Commercial record changed or conflicts with another airline."),
        CommercialWorkflowFailure.AirlineUnverified => Problem(statusCode: 409, title: "Verify the airline identity before approval."),
        _ => throw new InvalidOperationException(),
    };
}
