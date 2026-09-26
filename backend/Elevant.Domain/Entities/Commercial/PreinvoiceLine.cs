namespace Elevant.Domain.Entities.Commercial;

/// <summary>Immutable priced source line; never repriced from a later contract.</summary>
public sealed class PreinvoiceLine : AuditableEntity
{
    public long PreinvoiceId { get; set; }

    public long OperationServiceId { get; set; }

    public long ApprovedSubmissionId { get; set; }

    public int LineNumber { get; set; }

    public string OperationCode { get; set; } = string.Empty;

    public DateOnly OperationDate { get; set; }

    public string ServiceCode { get; set; } = string.Empty;

    public string ServiceName { get; set; } = string.Empty;

    public decimal ExecutedQuantity { get; set; }

    public string BillingUnit { get; set; } = string.Empty;

    public decimal UnitPrice { get; set; }

    public string CurrencyCode { get; set; } = string.Empty;

    public decimal Amount { get; set; }
}
