using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public sealed class Contract : AuditableEntity
{
    public long AirlineId { get; set; }

    public long? OriginatingServiceRequestId { get; set; }

    public string ContractCode { get; set; } = string.Empty;

    // Existing contracts predate electronic signing. Only new contracts opt in.
    public bool RequiresElectronicSigning { get; set; }

    public ContractStatus Status { get; set; }

    public DateOnly? SignedOn { get; set; }

    public DateOnly? TerminatedOn { get; set; }
}
