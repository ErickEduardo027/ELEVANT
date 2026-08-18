using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public sealed class ContractStatusEvent : Entity<long>
{
    public long ContractId { get; set; }

    public ContractStatus? FromStatus { get; set; }

    public ContractStatus ToStatus { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public long? ActorAccountId { get; set; }

    public string? Reason { get; set; }
}
