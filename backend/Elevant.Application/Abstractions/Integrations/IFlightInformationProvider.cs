namespace Elevant.Application.Abstractions.Integrations;

/// <summary>Provides normalized flight information without exposing a vendor SDK.</summary>
public interface IFlightInformationProvider
{
    /// <summary>Searches an external provider using a vendor-neutral query.</summary>
    Task<IReadOnlyCollection<ExternalFlightSummary>> SearchAsync(
        ExternalFlightQuery query,
        CancellationToken cancellationToken);
}

/// <summary>Vendor-neutral criteria for an external flight search.</summary>
public sealed record ExternalFlightQuery(
    string? FlightNumber,
    string? OriginAirportCode,
    string? DestinationAirportCode,
    DateOnly? DepartureDate);

/// <summary>Preliminary normalized result used only by the application boundary.</summary>
public sealed record ExternalFlightSummary(
    string ProviderFlightId,
    string? FlightNumber,
    string? OriginAirportCode,
    string? DestinationAirportCode,
    DateTimeOffset? ScheduledDepartureUtc,
    DateTimeOffset? ScheduledArrivalUtc,
    string? Status);
