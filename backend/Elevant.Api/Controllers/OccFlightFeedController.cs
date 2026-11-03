using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Contracts.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Flights the paid provider reported for contracted airlines (ADR-0028). Screens read the stored
/// proposals; only «Actualizar ahora» can trigger a provider call, within the same limits as the worker.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/flight-feed")]
public sealed class OccFlightFeedController(IOccFlightFeedStore store, FlightFeedSynchronizer synchronizer) : ControllerBase
{
    [HttpGet(Name = "GetOccFlightFeed")]
    [ProducesResponseType<OccFlightFeedResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<OccFlightFeedResponse>> Get([FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "date"), BindRequired] DateOnly date, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccFlightFeedResponse>();
        if (stationId == Guid.Empty) return Problem<OccFlightFeedResponse>(400, "The station is required.");
        var data = await store.ListAsync(actorId, stationId, date, cancellationToken);
        if (data is null) return Problem<OccFlightFeedResponse>(403, "OCC planning access is forbidden.");
        return Ok(new OccFlightFeedResponse(data.StationId, data.StationCode, data.Date,
            new OccFlightFeedBudgetResponse(data.Budget.Configured, data.Budget.Provider, data.Budget.UnitsToday,
                data.Budget.DailyUnits, data.Budget.UnitsThisMonth, data.Budget.MonthlyUnits, data.Budget.PausedUntil,
                data.Budget.PauseReason),
            data.LastReadAt, data.NextManualRefreshAt, data.CanImport,
            data.Proposals.Select(item => new OccFlightProposalResponse(item.ProposalId, item.Direction, item.FlightNumber,
                item.AirlineId, item.AirlineName, item.AirlineIataCode, item.CounterpartIata, item.CounterpartName,
                item.CounterpartKnown, item.ScheduledAt, item.RevisedAt, item.RunwayAt, item.ProviderStatus,
                item.AircraftRegistration, item.AircraftModel, item.Terminal, item.Gate, item.Status, item.TurnaroundId,
                item.SuggestedDepartureId, item.LastSeenAt)).ToArray()));
    }

    /// <summary>
    /// «Actualizar ahora»: one provider read of the active window, at most every ten minutes per
    /// station, reusing a read of the last five minutes and counted in the budget.
    /// </summary>
    [HttpPost("refresh", Name = "RefreshOccFlightFeed")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<RefreshOccFlightFeedResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<RefreshOccFlightFeedResponse>> Refresh([FromBody, BindRequired] RefreshOccFlightFeedRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<RefreshOccFlightFeedResponse>();
        if (request.StationId == Guid.Empty) return Problem<RefreshOccFlightFeedResponse>(400, "The station is required.");
        var result = await synchronizer.RefreshNowAsync(actorId, request.StationId, cancellationToken);
        if (result.Status == FlightFeedRefreshStatus.Forbidden)
            return Problem<RefreshOccFlightFeedResponse>(403, "Refreshing the flight feed is forbidden.");
        return Ok(new RefreshOccFlightFeedResponse(result.Status.ToString(), result.RetryAt, result.Ingest?.FlightsReceived,
            result.Ingest?.ContractedLegs, result.Ingest?.NewProposals));
    }

    /// <summary>Creates the turnaround of a proposed arrival and its departure; repeating it returns the same turnaround.</summary>
    [HttpPost("turnarounds", Name = "ImportOccFlight")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<ImportOccFlightResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<ImportOccFlightResponse>> Import([FromBody, BindRequired] ImportOccFlightRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<ImportOccFlightResponse>();
        if (request.ArrivalProposalId == Guid.Empty || request.DepartureProposalId == Guid.Empty ||
            request.ArrivalProposalId == request.DepartureProposalId)
            return Problem<ImportOccFlightResponse>(400, "An arrival and a departure are required.");
        var result = await store.ImportAsync(actorId, request.ArrivalProposalId, request.DepartureProposalId, cancellationToken);
        return result.Failure switch
        {
            null => Ok(new ImportOccFlightResponse(result.TurnaroundId!.Value, result.OperationCode!, result.Replayed)),
            _ => Failure<ImportOccFlightResponse>(result.Failure.Value),
        };
    }

    /// <summary>Hides a proposal OCC will not operate.</summary>
    [HttpPost("proposals/{proposalId:guid}/dismiss", Name = "DismissOccFlightProposal")]
    [ProducesResponseType(204)]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<IActionResult> Dismiss([FromRoute] Guid proposalId, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<object>().Result!;
        var failure = await store.DismissAsync(actorId, proposalId, cancellationToken);
        return failure is null ? NoContent() : Failure<object>(failure.Value).Result!;
    }

    private ActionResult<T> Failure<T>(OccFlightFeedFailure failure) => failure switch
    {
        OccFlightFeedFailure.Forbidden => Problem<T>(403, "OCC planning access is forbidden."),
        OccFlightFeedFailure.NotFound => Problem<T>(404, "The proposed flight was not found."),
        OccFlightFeedFailure.CounterpartUnknown => Problem<T>(409, "The origin or destination airport is not known yet."),
        _ => Problem<T>(409, "The proposed flights cannot be imported together."),
    };

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return Problem<T>(401, "Authentication failed.");
    }

    private ActionResult<T> Problem<T>(int status, string title) =>
        new ObjectResult(new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path })
            { StatusCode = status };
}
