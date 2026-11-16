using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Workforce;

public sealed class AirportPermitCycle : AuditableEntity
{
    public long RampAgentId { get; set; }

    /// <summary>A system code (<see cref="PermitDocumentTypes"/>) or the code of a custom permit type (ADR-0045).</summary>
    public string DocumentType { get; set; } = string.Empty;

    public int CycleNumber { get; set; }

    public string DocumentNumber { get; set; } = string.Empty;

    public DateOnly IssuedOn { get; set; }

    public DateOnly ExpiresOn { get; set; }

    public long? SupersedesPermitId { get; set; }

    public bool IsCurrent { get; set; }
}
