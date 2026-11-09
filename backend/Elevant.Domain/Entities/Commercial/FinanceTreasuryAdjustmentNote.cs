using Elevant.Domain.Enumerations;
namespace Elevant.Domain.Entities.Commercial;
/// <summary>Immutable commercial adjustment. It neither refunds money nor reissues the invoice.</summary>
public sealed class FinanceTreasuryAdjustmentNote : AuditableEntity
{
    public long InvoiceId { get; set; }
    public long ActorAccountId { get; set; }
    public Guid RequestId { get; set; }
    public long? RelatedNoteId { get; set; }
    public string Number { get; set; } = string.Empty;
    public FinanceTreasuryAdjustmentKind Kind { get; set; }
    public DateOnly EffectiveOn { get; set; }
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal Amount { get; set; }
    public string Reason { get; set; } = string.Empty;
}
public sealed class FinanceTreasuryAdjustmentLine : AuditableEntity
{
    public long NoteId { get; set; }
    public long InvoiceLineId { get; set; }
    public decimal Quantity { get; set; }
    /// <summary>The gross amount of the line, ITBIS included, as on the invoice line.</summary>
    public decimal Amount { get; set; }
    /// <summary>
    /// 4-N17: the net, ITBIS and rate frozen from the invoice line when the note was issued, an immutable fiscal
    /// snapshot like the invoice's; null on the notes issued before, and on a line that froze no tax.
    /// </summary>
    public decimal? NetAmount { get; set; }
    public decimal? TaxAmount { get; set; }
    public decimal? TaxRate { get; set; }
}
