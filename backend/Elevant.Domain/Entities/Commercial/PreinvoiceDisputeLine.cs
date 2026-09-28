namespace Elevant.Domain.Entities.Commercial;

/// <summary>One immutable priced line identified by an airline dispute.</summary>
public sealed class PreinvoiceDisputeLine : AuditableEntity
{
    public long DisputeId { get; set; }
    public long PreinvoiceLineId { get; set; }
}
