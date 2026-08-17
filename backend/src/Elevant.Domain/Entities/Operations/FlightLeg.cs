using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class FlightLeg : AuditableEntity
{
    public long TurnaroundId { get; set; }

    public FlightDirection Direction { get; set; }

    public string FlightNumber { get; set; } = string.Empty;

    public long OriginAirportId { get; set; }

    public long DestinationAirportId { get; set; }

    public DateTimeOffset ScheduledAt { get; set; }

    public DateTimeOffset? EstimatedAt { get; set; }

    public DateTimeOffset? ActualAt { get; set; }

    public OperationalDataSource Source { get; set; }

    public string? ExternalReference { get; set; }

    public DateTimeOffset? SourceObservedAt { get; set; }
}
