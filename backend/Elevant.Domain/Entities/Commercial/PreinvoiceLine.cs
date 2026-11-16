using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>Immutable priced source line; never repriced from a later contract.</summary>
public sealed class PreinvoiceLine : AuditableEntity
{
    public long PreinvoiceId { get; set; }

    public PreinvoiceLineKind Kind { get; set; } = PreinvoiceLineKind.Service;

    /// <summary>Executed service the line bills; null for manual adjustments.</summary>
    public long? OperationServiceId { get; set; }

    /// <summary>Service line a charge or adjustment belongs to, when it belongs to one.</summary>
    public long? ParentLineId { get; set; }

    public long? ChargeDefinitionId { get; set; }

    public long? ApprovedSubmissionId { get; set; }

    public int LineNumber { get; set; }

    public string OperationCode { get; set; } = string.Empty;

    public DateOnly OperationDate { get; set; }

    public string ServiceCode { get; set; } = string.Empty;

    public string ServiceName { get; set; } = string.Empty;

    public decimal ExecutedQuantity { get; set; }

    public string BillingUnit { get; set; } = string.Empty;

    public decimal UnitPrice { get; set; }

    public string CurrencyCode { get; set; } = string.Empty;

    /// <summary>Quantity and amount ELEVANT computed, kept when Finance edits the line; null on lines created before the edit capability.</summary>
    public decimal? ComputedQuantity { get; set; }

    public decimal? ComputedAmount { get; set; }

    /// <summary>Billed amount. Finance may edit it on a draft; adjustments may be negative.</summary>
    public decimal Amount { get; set; }

    public bool? ComputedIsExcluded { get; set; }

    public string? CalculationJson { get; set; }

    public bool IsExcluded { get; set; }

    public string? AdjustmentReason { get; set; }

    public long? EditedByAccountId { get; set; }

    public DateTimeOffset? EditedAt { get; set; }

    /// <summary>Set only when a disputed preinvoice is voided; preserves its historical snapshot.</summary>
    public DateTimeOffset? ReleasedAt { get; set; }

    // Null amounts distinguish legacy rows from captured, explicitly unconfigured treatments.
    public Guid? TaxPolicyPublicId { get; set; }
    public FinanceTaxTreatment TaxTreatment { get; set; }
    public decimal? TaxRate { get; set; }
    public string? TaxBasis { get; set; }
    /// <summary>Pretax base before discount. Amount remains the gross billed amount.</summary>
    public decimal? NetAmount { get; set; }
    public decimal? DiscountAmount { get; set; }
    /// <summary>Unknown for unconfigured treatments; an explicit zero is retained as zero.</summary>
    public decimal? TaxAmount { get; set; }
    public decimal? GrossAmount { get; set; }
    public DateTimeOffset? TaxCapturedAt { get; set; }
}
