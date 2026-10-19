namespace Elevant.Domain.Entities.Commercial;
public sealed class FinancePayablesPayment : AuditableEntity
{
    public long SupplierId { get; init; }
    public long ScopeStationId { get; init; }
    public string Reference { get; init; } = string.Empty;
    public DateOnly PaidOn { get; init; }
    public string CurrencyCode { get; init; } = string.Empty;
    public decimal FxToDop { get; init; }
    public string FxSource { get; init; } = string.Empty;
    public DateOnly FxDate { get; init; }
    public decimal Amount { get; init; }
    public decimal AmountDop { get; init; }
    public long CreatedByAccountId { get; init; }
}
public sealed class FinancePayablesApplication : Entity<long>
{
    public Guid PublicId { get; init; }
    public long PaymentId { get; init; }
    public long SupplierInvoiceId { get; init; }
    public decimal PaymentAmount { get; init; }
    public decimal InvoiceAmount { get; init; }
    public decimal RateToInvoice { get; init; }
    public long ActorAccountId { get; init; }
    public DateTimeOffset AppliedAt { get; init; }
}
