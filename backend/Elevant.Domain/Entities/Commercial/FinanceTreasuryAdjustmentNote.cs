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
    public decimal Amount { get; set; }
}
