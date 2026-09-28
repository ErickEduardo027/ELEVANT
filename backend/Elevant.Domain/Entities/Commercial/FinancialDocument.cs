namespace Elevant.Domain.Entities.Commercial;

/// <summary>Immutable private PDF metadata; binary content lives in S3, never SQL.</summary>
public sealed class FinancialDocument : AuditableEntity
{
    public long InvoiceId { get; set; }
    public long? PaymentId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public string ObjectKey { get; set; } = string.Empty;
    public string ContentType { get; set; } = "application/pdf";
    public long Length { get; set; }
    public string Sha256 { get; set; } = string.Empty;
}
