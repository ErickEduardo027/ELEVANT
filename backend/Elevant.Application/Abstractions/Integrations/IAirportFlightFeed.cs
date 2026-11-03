using Elevant.Domain.Enumerations;

namespace Elevant.Application.Abstractions.Integrations;

/// <summary>
/// A paid airport flight feed (FIDS) behind a vendor-neutral port (ADR-0028). Only the flight
/// feed synchronizer calls it; no screen ever does.
/// </summary>
public interface IAirportFlightFeed
{
    /// <summary>Provider name recorded in the usage ledger, e.g. «AeroDataBox».</summary>
    string Provider { get; }

    /// <summary>False when the feed is disabled or has no credential: nothing is called.</summary>
    bool IsConfigured { get; }

    /// <summary>Units one call costs at the provider, counted before calling.</summary>
    int UnitsPerCall { get; }

    /// <summary>Longest local-time window one call may cover.</summary>
    TimeSpan MaxWindow { get; }

    /// <summary>Arrivals and departures at an airport in a local-time window, in one call.</summary>
    Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
        CancellationToken cancellationToken = default);
}

/// <summary>Outcome of one feed call. <paramref name="Units"/> is what the provider charged.</summary>
public sealed record AirportFeedResponse(
    ProviderCallOutcome Outcome,
    int Units,
    int? HttpStatus,
    TimeSpan? RetryAfter,
    IReadOnlyList<FeedFlight> Flights)
{
    public static AirportFeedResponse Failure(ProviderCallOutcome outcome, int units, int? httpStatus,
        TimeSpan? retryAfter = null) => new(outcome, units, httpStatus, retryAfter, []);
}

/// <summary>One leg as the provider reports it at the station.</summary>
public sealed record FeedFlight(
    FlightDirection Direction,
    string Number,
    FeedAirline? Airline,
    FeedAirport? Counterpart,
    DateTimeOffset ScheduledUtc,
    DateTimeOffset? RevisedUtc,
    DateTimeOffset? RunwayUtc,
    string Status,
    string? Registration,
    string? AircraftModel,
    string? Terminal,
    string? Gate,
    bool IsCargo,
    string CodeshareStatus);

public sealed record FeedAirline(string Name, string? IataCode, string? IcaoCode);

/// <summary>The other airport of the leg (origin of an arrival, destination of a departure).</summary>
public sealed record FeedAirport(
    string? IataCode,
    string? IcaoCode,
    string Name,
    string? City,
    string? CountryCode,
    string? TimeZone,
    decimal? Latitude,
    decimal? Longitude);

/// <summary>
/// The feed when no provider adapter is registered (tests, tools): reports itself unconfigured and
/// never calls anything. Infrastructure registers the real or disabled adapter over it.
/// </summary>
public sealed class UnconfiguredAirportFlightFeed : IAirportFlightFeed
{
    public string Provider => "AeroDataBox";

    public bool IsConfigured => false;

    public int UnitsPerCall => 2;

    public TimeSpan MaxWindow => TimeSpan.FromHours(12);

    public Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(AirportFeedResponse.Failure(ProviderCallOutcome.Unauthorized, 0, null));
}
