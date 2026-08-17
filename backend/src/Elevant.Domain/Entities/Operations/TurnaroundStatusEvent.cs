using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class TurnaroundStatusEvent : Entity<long>
{
    public long TurnaroundId { get; set; }

    public TurnaroundStatus? FromStatus { get; set; }

    public TurnaroundStatus ToStatus { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public long? ActorAccountId { get; set; }

    public OperationalDataSource Source { get; set; }

    public string? Reason { get; set; }
}
