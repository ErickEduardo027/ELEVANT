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
}
