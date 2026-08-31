using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class OperationServiceStatusEvent : Entity<long>
{
    public long OperationServiceId { get; set; }

    public ServiceExecutionStatus? FromStatus { get; set; }

    public ServiceExecutionStatus ToStatus { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public long? RampAgentId { get; set; }

    public string? Note { get; set; }
}
