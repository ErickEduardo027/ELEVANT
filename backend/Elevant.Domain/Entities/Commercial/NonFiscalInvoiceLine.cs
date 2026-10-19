using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>Independent frozen copy of one accepted priced service line.</summary>
public sealed class NonFiscalInvoiceLine : AuditableEntity
{
    public long InvoiceId { get; set; }
    public long PreinvoiceLineId { get; set; }
    public int LineNumber { get; set; }

    public PreinvoiceLineKind Kind { get; set; } = PreinvoiceLineKind.Service;

    public int? ParentLineNumber { get; set; }

    public string? Reason { get; set; }
    public string OperationCode { get; set; } = string.Empty;
    public DateOnly OperationDate { get; set; }
    public string ServiceCode { get; set; } = string.Empty;
    public string ServiceName { get; set; } = string.Empty;
    public decimal ExecutedQuantity { get; set; }
    public string BillingUnit { get; set; } = string.Empty;
    public decimal UnitPrice { get; set; }
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public Guid? TaxPolicyPublicId { get; set; }
    public FinanceTaxTreatment TaxTreatment { get; set; }
    public decimal? TaxRate { get; set; }
    public string? TaxBasis { get; set; }
    public decimal? NetAmount { get; set; }
    public decimal? DiscountAmount { get; set; }
    public decimal? TaxAmount { get; set; }
    public decimal? GrossAmount { get; set; }
    public DateTimeOffset? TaxCapturedAt { get; set; }
}
