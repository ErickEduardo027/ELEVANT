using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>One manual Development payment record; not an external settlement.</summary>
public sealed class NonFiscalPayment : AuditableEntity
{
    public long InvoiceId { get; set; }
    public long RecordedByAccountId { get; set; }
    public Guid RequestId { get; set; }
    public string Reference { get; set; } = string.Empty;
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal Amount { get; set; }

    public PaymentMethod Method { get; set; } = PaymentMethod.Transfer;

    public DateOnly? PaidOn { get; set; }
}
