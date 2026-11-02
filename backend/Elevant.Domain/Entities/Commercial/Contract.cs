using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public sealed class Contract : AuditableEntity
{
    public long AirlineId { get; set; }

    public long? OriginatingServiceRequestId { get; set; }

    public string ContractCode { get; set; } = string.Empty;

    public ContractStatus Status { get; set; }

    public DateOnly? SignedOn { get; set; }

    public DateOnly? TerminatedOn { get; set; }

    /// <summary>When the 30-day expiry notice of the version in force went out (ADR-0024).</summary>
    public DateTimeOffset? ExpiryNoticeSentAt { get; set; }
}
