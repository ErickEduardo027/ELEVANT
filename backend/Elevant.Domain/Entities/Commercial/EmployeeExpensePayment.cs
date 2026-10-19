namespace Elevant.Domain.Entities.Commercial;
public sealed class EmployeeExpensePayment : Entity<long>
{
    public Guid PublicId { get; init; }
    public long ExpenseClaimId { get; init; }
    public string Reference { get; init; } = string.Empty;
    public DateOnly PaidOn { get; init; }
    public string CurrencyCode { get; init; } = string.Empty;
    public decimal FxToDop { get; init; }
    public string FxSource { get; init; } = string.Empty;
    public DateOnly FxDate { get; init; }
    public decimal Amount { get; init; }
    public decimal AmountDop { get; init; }
    public decimal ExpenseAmount { get; init; }
    public decimal RateToExpense { get; init; }
    public long ActorAccountId { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
}
