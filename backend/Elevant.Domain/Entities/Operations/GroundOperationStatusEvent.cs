using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class GroundOperationStatusEvent : Entity<long>
{
    public long GroundOperationId { get; set; }

    public GroundOperationStatus? FromStatus { get; set; }

    public GroundOperationStatus ToStatus { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public long? ActorAccountId { get; set; }

    public string? Reason { get; set; }
}
