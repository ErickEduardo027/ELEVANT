namespace Elevant.Domain.Entities.Commercial;

/// <summary>One immutable Finance decision on an airline's priced-line objection.</summary>
public sealed class PreinvoiceDisputeResolution : AuditableEntity
{
    public long DisputeId { get; set; }
    public long ResolvedByAccountId { get; set; }
    public Guid RequestId { get; set; }
    public string PayloadHash { get; set; } = string.Empty;
    public string Decision { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
}
