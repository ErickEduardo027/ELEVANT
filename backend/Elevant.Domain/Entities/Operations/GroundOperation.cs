using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class GroundOperation : AuditableEntity
{
    public long TurnaroundId { get; set; }

    public GroundOperationStatus CurrentStatus { get; set; }

    public DateTimeOffset? PlannedStartAt { get; set; }

    public DateTimeOffset? PlannedEndAt { get; set; }

    public DateTimeOffset? ActualStartAt { get; set; }

    public DateTimeOffset? ActualEndAt { get; set; }

    /// <summary>Flight data captured once on the ramp (ADR-0031); every form reads it from here.</summary>
    public int? PassengersIn { get; set; }

    public int? PassengersOut { get; set; }

    public int? MtowKg { get; set; }
}
