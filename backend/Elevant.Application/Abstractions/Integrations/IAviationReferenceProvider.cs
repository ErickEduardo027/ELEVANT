using Elevant.Domain.Enumerations;

namespace Elevant.Application.Abstractions.Integrations;

/// <summary>
/// The paid reference reads of the aviation data provider (ADR-0028, note of 15 November 2026), behind a vendor-neutral
/// port: an airline's fleet, an aircraft by its registration, an airport's daily routes and its current delays. Only
/// <see cref="Elevant.Application.Integration.AviationReference.AviationReferenceReader"/> calls it, when a screen asks for something its
/// cache does not hold, within the caps of each read; nothing calls it at startup or in the background.
/// </summary>
public interface IAviationReferenceProvider
{
    /// <summary>Provider name recorded in the usage ledger, e.g. «AeroDataBox».</summary>
    string Provider { get; }

    /// <summary>False when the provider is disabled or has no credential: nothing is called.</summary>
    bool IsConfigured { get; }

    /// <summary>The first page of the fleet of the airline with ICAO (3 letters) or IATA (2 characters) code <paramref name="airlineCode"/>.</summary>
    Task<ReferenceCall<AirlineFleetFacts>> GetAirlineFleetAsync(string airlineCode, CancellationToken cancellationToken = default);

    /// <summary>The aircraft that best matches the registration (tail number) <paramref name="registration"/>.</summary>
    Task<ReferenceCall<AircraftFacts>> GetAircraftAsync(string registration, CancellationToken cancellationToken = default);

    /// <summary>The routes and average daily flights from the airport with ICAO code <paramref name="airportIcao"/>.</summary>
    Task<ReferenceCall<AirportRouteFacts>> GetDailyRoutesAsync(string airportIcao, CancellationToken cancellationToken = default);

    /// <summary>The delays of the last two hours at the airport with IATA (3) or ICAO (4) code <paramref name="airportCode"/>.</summary>
    Task<ReferenceCall<AirportDelayFacts>> GetDelaysAsync(string airportCode, CancellationToken cancellationToken = default);
}

/// <summary>
/// One reference call. <paramref name="Units"/> is what the provider charged; <paramref name="Value"/> is null when the
/// call failed or the provider had nothing (<see cref="ProviderCallOutcome.NoContent"/>).
/// </summary>
public sealed record ReferenceCall<T>(ProviderCallOutcome Outcome, int Units, int? HttpStatus, TimeSpan? RetryAfter, T? Value)
    where T : class
{
    public static ReferenceCall<T> Failure(ProviderCallOutcome outcome, int units, int? httpStatus, TimeSpan? retryAfter = null) =>
        new(outcome, units, httpStatus, retryAfter, null);
}

/// <summary>
/// An airline's fleet as the provider knows it: the total of active aircraft it verified and the first page of them
/// (<paramref name="Sample"/>, at most the page size of the plan, 25 on Starter).
/// </summary>
public sealed record AirlineFleetFacts(int TotalAircraft, IReadOnlyList<AircraftFacts> Sample);

/// <summary>
/// An aircraft: registration, whether it is active under it, its type and model, who operates it and its dates. Every
/// value the provider does not give is null.
/// </summary>
public sealed record AircraftFacts(
    string Registration,
    bool Active,
    string? Model,
    string? TypeName,
    string? IcaoType,
    string? IataType,
    string? Operator,
    string? Serial,
    string? ModeS,
    int? Seats,
    int? Engines,
    string? EngineType,
    double? AgeYears,
    DateOnly? FirstFlight,
    DateOnly? Delivered,
    DateOnly? Registered,
    bool IsFreighter);

/// <summary>The daily routes from an airport, most frequent first.</summary>
public sealed record AirportRouteFacts(IReadOnlyList<AirportRoute> Routes);

/// <summary>A destination, its average daily flights and the airlines that fly it.</summary>
public sealed record AirportRoute(string? DestinationIata, string? DestinationIcao, string Name, string? City,
    string? CountryCode, double? Latitude, double? Longitude, double AverageDailyFlights, IReadOnlyList<string> Operators);

/// <summary>The delays of the flights of an airport between <paramref name="From"/> and <paramref name="To"/> (UTC).</summary>
public sealed record AirportDelayFacts(string AirportIcao, DateTimeOffset From, DateTimeOffset To, DelayBatch Arrivals,
    DelayBatch Departures);

/// <summary>
/// A batch of flights: how many there were, how many counted, how many were cancelled, the median delay in minutes
/// (negative when early) and the provider's delay index from 0 to 5.
/// </summary>
public sealed record DelayBatch(int Total, int Qualified, int Cancelled, int? MedianDelayMinutes, double? DelayIndex);

/// <summary>
/// The provider when no adapter is registered (tests, tools): reports itself unconfigured and never calls anything.
/// Infrastructure registers the real or disabled adapter over it.
/// </summary>
public sealed class UnconfiguredAviationReferenceProvider : IAviationReferenceProvider
{
    public string Provider => "AeroDataBox";

    public bool IsConfigured => false;

    public Task<ReferenceCall<AirlineFleetFacts>> GetAirlineFleetAsync(string airlineCode, CancellationToken cancellationToken = default) =>
        Task.FromResult(ReferenceCall<AirlineFleetFacts>.Failure(ProviderCallOutcome.Unauthorized, 0, null));

    public Task<ReferenceCall<AircraftFacts>> GetAircraftAsync(string registration, CancellationToken cancellationToken = default) =>
        Task.FromResult(ReferenceCall<AircraftFacts>.Failure(ProviderCallOutcome.Unauthorized, 0, null));

    public Task<ReferenceCall<AirportRouteFacts>> GetDailyRoutesAsync(string airportIcao, CancellationToken cancellationToken = default) =>
        Task.FromResult(ReferenceCall<AirportRouteFacts>.Failure(ProviderCallOutcome.Unauthorized, 0, null));

    public Task<ReferenceCall<AirportDelayFacts>> GetDelaysAsync(string airportCode, CancellationToken cancellationToken = default) =>
        Task.FromResult(ReferenceCall<AirportDelayFacts>.Failure(ProviderCallOutcome.Unauthorized, 0, null));
}
