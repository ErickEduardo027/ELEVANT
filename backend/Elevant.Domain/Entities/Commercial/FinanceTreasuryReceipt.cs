using Elevant.Domain.Enumerations;
namespace Elevant.Domain.Entities.Commercial;
/// <summary>Cash receipt independent of invoices. Only UpdatedAt/RowVersion change when posting a movement.</summary>
public sealed class FinanceTreasuryReceipt : AuditableEntity
{
    public long AirlineId { get; set; }
    public long StationId { get; set; }
    public long ActorAccountId { get; set; }
    public Guid RequestId { get; set; }
    public string Reference { get; set; } = string.Empty;
    public string CurrencyCode { get; set; } = string.Empty;
    public PaymentMethod Method { get; set; }
    public DateOnly ReceivedOn { get; set; }
    public decimal Amount { get; set; }
    public string Reason { get; set; } = string.Empty;
}
/// <summary>Append-only cash/application event. Reversals preserve the original amounts and exchange rate.</summary>
public sealed class FinanceTreasuryMovement : AuditableEntity
{
    public long ReceiptId { get; set; }
    public long? InvoiceId { get; set; }
    public long? ReversesMovementId { get; set; }
    public long ActorAccountId { get; set; }
    public Guid RequestId { get; set; }
    public FinanceTreasuryMovementKind Kind { get; set; }
    public DateOnly EffectiveOn { get; set; }
    public decimal ReceiptAmount { get; set; }
    public decimal InvoiceAmount { get; set; }
    public string ReceiptCurrency { get; set; } = string.Empty;
    public string? InvoiceCurrency { get; set; }
    public decimal ExchangeRate { get; set; }
    public DateOnly ExchangeRateOn { get; set; }
    public string Reference { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
}
/// <summary>Concurrency token for treasury activity; the issued invoice remains immutable.</summary>
public sealed class FinanceTreasuryInvoiceAccount : AuditableEntity
{
    public long InvoiceId { get; set; }
}
/// <summary>Immutable idempotency result, including payload, actor, scope and original resulting version.</summary>
public sealed class FinanceTreasuryRequest : AuditableEntity
{
    public Guid RequestId { get; set; }
    public Guid ResourceId { get; set; }
    public long ActorAccountId { get; set; }
    public string Operation { get; set; } = string.Empty;
    public string PayloadHash { get; set; } = string.Empty;
    public Guid ResultId { get; set; }
    public string ResultVersion { get; set; } = string.Empty;
}
