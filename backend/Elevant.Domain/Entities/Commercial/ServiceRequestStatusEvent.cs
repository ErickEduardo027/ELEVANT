using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public sealed class ServiceRequestStatusEvent : Entity<long>
{
    public long ServiceRequestId { get; set; }

    public CommercialRequestStatus? FromStatus { get; set; }

    public CommercialRequestStatus ToStatus { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public long? ActorAccountId { get; set; }

    public string? Reason { get; set; }
}
