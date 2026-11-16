namespace Elevant.Domain.Entities.Reference;

/// <summary>
/// A permit a stand requires (ADR-0045): the agent who covers it or works a flight on it needs a current cycle of
/// <see cref="DocumentTypeCode"/> (a system code or a permit type of the catalog). OCC sets the list; a removed
/// requirement is deleted from this list, the change is audited.
/// </summary>
public sealed class StandRequiredPermit : AuditableEntity
{
    public long StandId { get; set; }

    public string DocumentTypeCode { get; set; } = string.Empty;
}
