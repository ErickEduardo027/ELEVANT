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
/// Flights the flight feed reported for registered airlines (ADR-0028). Screens read the stored proposals;
/// only «Actualizar ahora» can trigger a provider call, within the same limits as the worker. Every failure
/// carries a stable code and a Spanish title (phase 2, block C).
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ/flight-feed")]
public sealed class OccFlightFeedController(IOccFlightFeedStore store, FlightFeedSynchronizer synchronizer) : ControllerBase
{
    /// <summary>
    /// The proposals of a station and date. <c>view</c> is <c>Contracted</c> (default: airlines with a contract
    /// in force that day), <c>Charter</c> (carriers without contract, ADR-0033) or <c>Dismissed</c> (2-N36).
    /// Airlines whose contract at the station is suspended or expired are in none (2-N16).
    /// </summary>
    [HttpGet(Name = "GetOccFlightFeed")]
    [ProducesResponseType<OccFlightFeedResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    public async Task<ActionResult<OccFlightFeedResponse>> Get([FromQuery, BindRequired] Guid stationId,
        [FromQuery(Name = "date"), BindRequired] DateOnly date, [FromQuery(Name = "view")] string? view,
        CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<OccFlightFeedResponse>();
        if (stationId == Guid.Empty) return Coded<OccFlightFeedResponse>(400, "La estación es obligatoria.", "invalid_flight_feed_query");
        var selected = OccFlightFeedView.Contracted;
        // Only the names of the views are accepted, never their numbers.
        if (view is not null && (!view.All(char.IsAsciiLetter) || !Enum.TryParse(view, false, out selected) ||
                                 !Enum.IsDefined(selected)))
            return Coded<OccFlightFeedResponse>(400, "La vista de vuelos propuestos no es válida.", "invalid_flight_feed_query");
        var data = await store.ListAsync(actorId, stationId, date, selected, cancellationToken);
        if (data is null) return Coded<OccFlightFeedResponse>(403, "No tiene acceso a la planificación de esta estación.", "forbidden");
        return Ok(new OccFlightFeedResponse(data.StationId, data.StationCode, data.Date,
            new OccFlightFeedBudgetResponse(data.Budget.Configured, data.Budget.Provider, data.Budget.UnitsToday,
                data.Budget.DailyUnits, data.Budget.UnitsThisMonth, data.Budget.MonthlyUnits, data.Budget.PausedUntil,
                data.Budget.PauseReason),
            data.LastReadAt, data.NextManualRefreshAt, data.CanImport,
            data.Proposals.Select(item => new OccFlightProposalResponse(item.ProposalId, item.Direction, item.FlightNumber,
                item.AirlineId, item.AirlineName, item.AirlineIataCode, item.CounterpartIata, item.CounterpartName,
                item.CounterpartKnown, item.ScheduledAt, item.RevisedAt, item.RunwayAt, item.ProviderStatus,
                item.AircraftRegistration, item.AircraftModel, item.Terminal, item.Gate, item.Status, item.TurnaroundId,
                item.SuggestedDepartureId, item.LastSeenAt, item.Version, item.SuggestedAircraftTypeId)).ToArray()));
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
        if (request.StationId == Guid.Empty)
            return Coded<RefreshOccFlightFeedResponse>(400, "La estación es obligatoria.", "invalid_flight_feed_query");
        var result = await synchronizer.RefreshNowAsync(actorId, request.StationId, cancellationToken);
        if (result.Status == FlightFeedRefreshStatus.Forbidden)
            return Coded<RefreshOccFlightFeedResponse>(403, "No tiene acceso a la planificación de esta estación.", "forbidden");
        return Ok(new RefreshOccFlightFeedResponse(result.Status.ToString(), result.RetryAt, result.Ingest?.FlightsReceived,
            result.Ingest?.ContractedLegs, result.Ingest?.NewProposals));
    }

    /// <summary>
    /// Creates the turnaround of a proposed arrival and its departure, optionally with its aircraft type, stand
    /// and as a charter without contract (2-B, ADR-0033). The Idempotency-Key is optional while older screens
    /// exist (expand): without it repeating the pair returns the same turnaround; with it the expected versions
    /// of both proposals are required and a retry replays the first result.
    /// </summary>
    [HttpPost("turnarounds", Name = "ImportOccFlight")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<ImportOccFlightResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<ImportOccFlightResponse>> Import([FromBody, BindRequired] ImportOccFlightRequest request,
        [FromHeader(Name = "Idempotency-Key")] Guid? idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<ImportOccFlightResponse>();
        var result = await store.ImportAsync(actorId, new OccFlightImportInput(request.ArrivalProposalId,
            request.DepartureProposalId, request.AircraftTypeId, request.StandId, request.Charter == true,
            request.ExpectedArrivalVersion, request.ExpectedDepartureVersion), idempotencyKey, cancellationToken);
        return result.Failure is { } failure
            ? Failure<ImportOccFlightResponse>(failure, result.Code, result.Reasons)
            : Ok(new ImportOccFlightResponse(result.TurnaroundId!.Value, result.OperationCode!, result.Replayed));
    }

    /// <summary>Hides a proposal OCC will not operate; «Descartadas» keeps it while its flight has not passed.</summary>
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
        return failure is null
            ? NoContent()
            : Failure<object>(failure.Value, failure == OccFlightFeedFailure.Conflict ? "flight_proposal_closed" : null, null).Result!;
    }

    /// <summary>
    /// Brings a dismissed proposal back to the review while its flight has not passed (2-N36), with the version
    /// OCC saw and an Idempotency-Key; a retry replays the first result.
    /// </summary>
    [HttpPost("proposals/{proposalId:guid}/restore", Name = "RestoreOccFlightProposal")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<RestoreOccFlightProposalResponse>(200, "application/json")]
    [ProducesResponseType<ProblemDetails>(400, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(401, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(403, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(404, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(409, "application/problem+json")]
    public async Task<ActionResult<RestoreOccFlightProposalResponse>> Restore([FromRoute] Guid proposalId,
        [FromBody, BindRequired] RestoreOccFlightProposalRequest request,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!TryAccount(out var actorId)) return Unauthorized<RestoreOccFlightProposalResponse>();
        var result = await store.RestoreAsync(actorId, proposalId, request.ExpectedVersion, idempotencyKey, cancellationToken);
        return result.Failure is { } failure
            ? Failure<RestoreOccFlightProposalResponse>(failure, result.Code, null)
            : Ok(new RestoreOccFlightProposalResponse(result.ProposalId!.Value, "Proposed", result.Version!, result.Replayed));
    }

    private ActionResult<T> Failure<T>(OccFlightFeedFailure failure, string? code, IReadOnlyList<string>? reasons)
    {
        var (status, title, fallback) = failure switch
        {
            OccFlightFeedFailure.Forbidden => (403, "No tiene acceso a la planificación de esta estación.", "forbidden"),
            OccFlightFeedFailure.NotFound => (404, "El vuelo propuesto ya no está disponible.", "not_found"),
            OccFlightFeedFailure.Invalid => (400, "Los datos de la importación no son válidos.", "invalid_flight_import"),
            OccFlightFeedFailure.CounterpartUnknown => (409, "Aún no se conoce el aeropuerto de origen o destino.",
                "flight_counterpart_unknown"),
            _ => (409, "El vuelo propuesto cambió o no se puede importar así.", "flight_proposals_not_pairable"),
        };
        return Coded<T>(status, title, code ?? fallback, reasons);
    }

    private bool TryAccount(out Guid actorId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    private ActionResult<T> Unauthorized<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails { Status = 401, Title = "Authentication failed.", Instance = HttpContext.Request.Path })
            { StatusCode = 401 };
    }

    private ActionResult<T> Coded<T>(int status, string title, string code, IReadOnlyList<string>? reasons = null)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        if (reasons is { Count: > 0 }) problem.Extensions["reasons"] = reasons;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
