using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Workforce;

public sealed class AirportPermitCycle : AuditableEntity
{
    public long RampAgentId { get; set; }

    public PermitDocumentType DocumentType { get; set; }

    public int CycleNumber { get; set; }

    public string DocumentNumber { get; set; } = string.Empty;

    public DateOnly IssuedOn { get; set; }

    public DateOnly ExpiresOn { get; set; }

    public long? SupersedesPermitId { get; set; }

    public bool IsCurrent { get; set; }
}
