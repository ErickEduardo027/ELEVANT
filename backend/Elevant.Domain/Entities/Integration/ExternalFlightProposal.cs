using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Integration;

/// <summary>
/// A flight leg a provider reported for a contracted airline at a station (ADR-0028). OCC confirms
/// an arrival with its departure into a turnaround, or dismisses it. Later provider reads update
/// the times and status, and the confirmed flight leg with them.
/// </summary>
public sealed class ExternalFlightProposal : AuditableEntity
{
    public string Provider { get; set; } = string.Empty;

    /// <summary>Stable key of the leg at the provider: number, direction and scheduled UTC time.</summary>
    public string ExternalReference { get; set; } = string.Empty;

    public long StationId { get; set; }

    public long AirlineId { get; set; }

    public DateOnly OperationDate { get; set; }

    public FlightDirection Direction { get; set; }

    public string FlightNumber { get; set; } = string.Empty;

    public long? CounterpartAirportId { get; set; }

    public string? CounterpartIata { get; set; }

    public string? CounterpartName { get; set; }

    public DateTimeOffset ScheduledAt { get; set; }

    public DateTimeOffset? RevisedAt { get; set; }

    public DateTimeOffset? RunwayAt { get; set; }

    public string ProviderStatus { get; set; } = string.Empty;

    public string? AircraftRegistration { get; set; }

    public string? AircraftModel { get; set; }

    public string? Terminal { get; set; }

    public string? Gate { get; set; }

    public DateTimeOffset FirstSeenAt { get; set; }

    public DateTimeOffset LastSeenAt { get; set; }

    public ExternalFlightProposalStatus Status { get; set; }

    public long? TurnaroundId { get; set; }

    public long? FlightLegId { get; set; }

    public long? DecidedByAccountId { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }
}
