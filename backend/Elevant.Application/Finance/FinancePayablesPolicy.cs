using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public static class FinancePayablesPolicy
{
    /// <summary>Common employee access is independent of departmental Finance grants.</summary>
    public static bool CanUseOwnExpenses(ActorContext actor, bool hasActiveEmployee) =>
        actor.AccountId != Guid.Empty && hasActiveEmployee && actor.StationScopes.Any(s => s.StationId != Guid.Empty) &&
        actor.Memberships.Any(m => m.Kind == MembershipKind.InternalStaff && m.OrganizationType == OrganizationType.AviamOperator);

    public const decimal MaximumMoney = 999_999_999_999_999.9999m;
    public static bool Money(decimal value) => value >= 0 && value <= MaximumMoney && decimal.Round(value, 4) == value;
    public static bool Quantity(decimal value) => value > 0 && value <= 99_999_999_999_999.9999m && decimal.Round(value, 4) == value;
    public static decimal Round(decimal value) => decimal.Round(value, 4, MidpointRounding.AwayFromZero);
    public static decimal LineTotal(decimal quantity, decimal price, decimal tax) => Round(quantity * price) + tax;
    public static bool ValidFx(string? currency, decimal? rate, string? source, DateOnly? date) =>
        currency is "USD" or "DOP" && rate is > 0 and <= 1_000_000m && decimal.Round(rate.Value, 8) == rate &&
        (currency != "DOP" || rate == 1) && !string.IsNullOrWhiteSpace(source) && source.Length <= 160 && date is not null;
    public static decimal Remaining(decimal total, IEnumerable<decimal> applications) => total - applications.Sum();
    public static bool CanApply(decimal paymentRemaining, decimal documentRemaining, decimal amount, decimal? rate)
    {
        if (!Money(amount) || amount <= 0 || rate is null or <= 0 || amount > paymentRemaining) return false;
        try { var applied = Round(amount * rate.Value); return applied > 0 && Money(applied) && applied <= documentRemaining; }
        catch (OverflowException) { return false; }
    }
    public static bool CanReviewDepartment(Guid actor, Guid requester, DepartmentAccess? access, Department department) =>
        actor != requester && access is { Kind: DepartmentAssignmentKind.Administrator } && access.Department == department;
    public static bool CanTransitionExpense(string from, string to, string? reason) => (from, to) switch
    {
        ("Draft", "Submitted") => true,
        ("Submitted", "DepartmentApproved") => true,
        ("DepartmentApproved", "Approved") => true,
        ("Submitted" or "DepartmentApproved", "Rejected") => !string.IsNullOrWhiteSpace(reason),
        _ => false,
    };
    public static bool CanTransitionInvoice(string from, string to, string? reason) => (from, to) switch
    {
        ("Draft", "Submitted") or ("Submitted", "Approved") => true,
        ("Submitted", "Rejected") => !string.IsNullOrWhiteSpace(reason),
        _ => false,
    };
}
