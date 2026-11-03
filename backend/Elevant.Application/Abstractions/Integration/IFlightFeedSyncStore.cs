using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Abstractions.Integration;

/// <summary>A station the flight feed reads: active, with an airport IATA code and its time zone.</summary>
public sealed record FlightFeedStation(long StationId, Guid StationPublicId, string Code, string AirportIataCode,
    string TimeZoneId);

/// <summary>Pause, back-off and units already spent of a provider.</summary>
public sealed record FlightFeedProviderState(DateTimeOffset? PausedUntil, int ConsecutiveFailures, string? LastError,
    int UnitsToday, int UnitsThisMonth);

/// <summary>What the station already has: contracts, contracted flights today and recent reads.</summary>
public sealed record FlightFeedStationActivity(bool HasContractsToday, bool HasContractsTomorrow,
    IReadOnlyList<DateTimeOffset> ContractedFlightTimesToday, IReadOnlyList<FlightFeedFetch> RecentFetches,
    DateTimeOffset? LastManualRefreshAt);

/// <summary>One call made to the provider, as it is recorded in the usage ledger.</summary>
public sealed record FlightFeedCall(string Provider, FlightFeedStation Station, DateTime FromLocal, DateTime ToLocal,
    ProviderCallTrigger Trigger, Guid? RequestedBy, DateTimeOffset OccurredAt);

/// <summary>What one successful read changed.</summary>
public sealed record FlightFeedIngestResult(int FlightsReceived, int ContractedLegs, int NewProposals,
    int UpdatedLegs, int AirlinesSeen, int AirportsAdded);

/// <summary>Persistence of the flight feed synchronization (ADR-0028).</summary>
public interface IFlightFeedSyncStore
{
    /// <summary>Takes the provider's single sync slot until <paramref name="until"/>; false if another holder has it.</summary>
    Task<bool> TryAcquireLeaseAsync(string provider, Guid holder, DateTimeOffset now, DateTimeOffset until,
        CancellationToken cancellationToken = default);

    Task ReleaseLeaseAsync(string provider, Guid holder, CancellationToken cancellationToken = default);

    Task<FlightFeedProviderState> GetStateAsync(string provider, DateTimeOffset now,
        CancellationToken cancellationToken = default);

    /// <summary>Stores the pause and back-off after a call; null clears the pause.</summary>
    Task SetPauseAsync(string provider, DateTimeOffset? pausedUntil, int consecutiveFailures, string? lastError,
        CancellationToken cancellationToken = default);

    /// <summary>Active stations with a contract that covers today or tomorrow.</summary>
    Task<IReadOnlyList<FlightFeedStation>> ListStationsAsync(DateTimeOffset now,
        CancellationToken cancellationToken = default);

    Task<FlightFeedStationActivity> GetActivityAsync(string provider, FlightFeedStation station, DateTimeOffset now,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the call in the usage ledger and, when it succeeded, keeps the legs of contracted
    /// airlines as proposals, updates confirmed legs, and keeps every airline and airport seen.
    /// </summary>
    Task<FlightFeedIngestResult> RecordAsync(FlightFeedCall call, AirportFeedResponse response,
        CancellationToken cancellationToken = default);

    /// <summary>The station when the actor may refresh it («Crear escalas» in planning, station in scope).</summary>
    Task<FlightFeedStation?> AuthorizeManualRefreshAsync(Guid actorId, Guid stationId,
        CancellationToken cancellationToken = default);
}
