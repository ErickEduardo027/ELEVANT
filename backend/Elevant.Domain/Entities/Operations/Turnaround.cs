using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class Turnaround : AuditableEntity
{
    public string OperationCode { get; set; } = string.Empty;

    public long AirlineId { get; set; }

    public long StationId { get; set; }

    public DateOnly OperationDate { get; set; }

    public long? AircraftTypeId { get; set; }

    public string? AircraftRegistration { get; set; }

    public TurnaroundStatus CurrentStatus { get; set; }

    public OperationalDataSource Source { get; set; }

    public string? ExternalProvider { get; set; }

    public string? ExternalReference { get; set; }

    public DateTimeOffset? SourceObservedAt { get; set; }
}
