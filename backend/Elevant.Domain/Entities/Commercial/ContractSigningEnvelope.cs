namespace Elevant.Domain.Entities.Commercial;

/// <summary>One immutable document and Adobe agreement per approved contract version.</summary>
public sealed class ContractSigningEnvelope : AuditableEntity
{
    public long ContractVersionId { get; set; }
    public string SigningMethod { get; set; } = "Adobe";
    public string Status { get; set; } = "Prepared";
    public long AviamSignerAccountId { get; set; }
    public long AirlineSignerAccountId { get; set; }
    public string AviamSignerEmail { get; set; } = string.Empty;
    public string AirlineSignerEmail { get; set; } = string.Empty;
    public string TemplateVersion { get; set; } = string.Empty;
    public string TemplateSha256 { get; set; } = string.Empty;
    public string? SnapshotJson { get; set; }
    public string DraftObjectKey { get; set; } = string.Empty;
    public string DraftSha256 { get; set; } = string.Empty;
    public string? AdobeAgreementId { get; set; }
    public string? SignedObjectKey { get; set; }
    public string? SignedSha256 { get; set; }
    public string? AuditObjectKey { get; set; }
    public string? AuditSha256 { get; set; }
    public DateTimeOffset? IssuedAt { get; set; }
    public DateTimeOffset? FormalizedAt { get; set; }
    public DateTimeOffset? AviamAcceptedAt { get; set; }
    public DateTimeOffset? AirlineAcceptedAt { get; set; }
    public Guid? AviamAcceptanceRequestId { get; set; }
    public Guid? AirlineAcceptanceRequestId { get; set; }
    public DateTimeOffset? LastCheckedAt { get; set; }
    public DateTimeOffset? NextCheckAt { get; set; }
    public int CheckAttempts { get; set; }
}
