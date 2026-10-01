namespace Elevant.Domain.Entities.Commercial;

/// <summary>Immutable airline objection to a published non-fiscal preinvoice.</summary>
public sealed class PreinvoiceDispute : AuditableEntity
{
    public long PreinvoiceId { get; set; }
    public long SubmittedByAccountId { get; set; }
    public Guid RequestId { get; set; }
    public string PayloadHash { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
}
