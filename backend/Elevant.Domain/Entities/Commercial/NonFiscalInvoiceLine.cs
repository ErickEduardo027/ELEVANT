namespace Elevant.Domain.Entities.Commercial;

/// <summary>Independent frozen copy of one accepted priced service line.</summary>
public sealed class NonFiscalInvoiceLine : AuditableEntity
{
    public long InvoiceId { get; set; }
    public long PreinvoiceLineId { get; set; }
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
