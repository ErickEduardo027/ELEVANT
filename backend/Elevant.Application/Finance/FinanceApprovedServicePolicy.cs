using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record FinanceServiceValuation(bool Ready, string? BlockingReason, decimal? Amount);

/// <summary>Evaluates frozen operation-service evidence, never a live tariff.</summary>
public static class FinanceApprovedServicePolicy
{
    public static bool IsValidWindow(DateOnly from, DateOnly to) =>
        from != default && to != default &&
        to >= from && to.DayNumber - from.DayNumber <= 30;

    public static FinanceServiceValuation Evaluate(
        ServiceExecutionStatus status,
        decimal executedQuantity,
        decimal? frozenUnitPrice,
        string? frozenCurrency,
        string? frozenBillingUnit)
    {
        if (status != ServiceExecutionStatus.Completed)
            return Blocked("service_not_completed");
        if (executedQuantity <= 0)
            return Blocked("no_executed_quantity");
        if (frozenUnitPrice is null or < 0)
            return Blocked("missing_frozen_rate");
        if (frozenCurrency is null || frozenCurrency.Length != 3 ||
            frozenCurrency.Any(character => character is < 'A' or > 'Z'))
            return Blocked("invalid_currency");
        if (string.IsNullOrWhiteSpace(frozenBillingUnit))
            return Blocked("invalid_billing_unit");

        try
        {
            return new FinanceServiceValuation(true, null,
                executedQuantity * frozenUnitPrice.Value);
        }
        catch (OverflowException)
        {
            return Blocked("invalid_amount");
        }
    }

    private static FinanceServiceValuation Blocked(string reason) =>
        new(false, reason, null);
}
