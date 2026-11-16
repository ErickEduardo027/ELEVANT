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

    /// <summary>Phase 4: a reason (rejecting, correcting, voiding, reversing, withdrawing, discarding) has 5 to 500 characters.</summary>
    public const int MinimumReason = 5;
    public const int MaximumReason = 500;
    public static bool ValidReason(string? reason) => reason?.Trim().Length is >= MinimumReason and <= MaximumReason;
    /// <summary>An optional reason (an approval note) only has to fit its column.</summary>
    public static bool ValidOptionalReason(string? reason) => reason is null || reason.Trim().Length <= MaximumReason;

    public static bool CanReviewDepartment(Guid actor, Guid requester, DepartmentAccess? access, Department department) =>
        actor != requester && access is { Kind: DepartmentAssignmentKind.Administrator } && access.Department == department;

    /// <summary>
    /// Whether an employee expense may move from one status to another: null when it may not, otherwise whether the move
    /// needs a reason. 4-N13: the requester withdraws a claim the department has not decided yet, corrects a rejected one
    /// and discards a draft or a rejected one (Cancelled); each of those keeps its reason in the history.
    /// </summary>
    public static bool? ExpenseTransitionNeedsReason(string from, string to) => (from, to) switch
    {
        ("Draft", "Submitted") or ("Submitted", "DepartmentApproved") or ("DepartmentApproved", "Approved") => false,
        ("Submitted" or "DepartmentApproved", "Rejected") => true,
        ("Submitted" or "Rejected", "Draft") => true,
        ("Draft" or "Rejected", "Cancelled") => true,
        _ => null,
    };
    public static bool CanTransitionExpense(string from, string to, string? reason) =>
        ExpenseTransitionNeedsReason(from, to) is { } needsReason && (!needsReason || ValidReason(reason));

    /// <summary>
    /// 4-N13: who reviews a submitted expense. «Department» while another administrator of its department holds the
    /// station; otherwise «Finance» (a Finance administrator reviews it as an escalation); «None» when nobody can, so the
    /// employee asks Governance for another reviewer instead of waiting in silence.
    /// </summary>
    public static string ExpenseReviewRoute(bool hasDepartmentReviewer, bool hasFinanceAdministrator) =>
        hasDepartmentReviewer ? "Department" : hasFinanceAdministrator ? "Finance" : "None";

    /// <summary>
    /// 4-N13: on the «Finance» route a Finance administrator who is not the requester reviews the submitted expense in
    /// place of its department (the «Escalation» stage); another person of Finance gives the final approval.
    /// </summary>
    public static bool CanEscalateExpenseReview(Guid actor, Guid requester, DepartmentAccess? access) =>
        actor != requester && access is { Kind: DepartmentAssignmentKind.Administrator, Department: Department.Finance };

    /// <summary>
    /// Whether a supplier invoice may move from one status to another: null when it may not, otherwise whether the move
    /// needs a reason. 4-N03: a rejected invoice returns to Draft to be corrected, and a draft, a rejected invoice or an
    /// approved one without active applications is voided. A submitted invoice is approved or rejected first, and an
    /// approved one never returns to Draft: its balance was already reported, so it is voided and registered again.
    /// </summary>
    public static bool? InvoiceTransitionNeedsReason(string from, string to) => (from, to) switch
    {
        ("Draft", "Submitted") or ("Submitted", "Approved") => false,
        ("Submitted", "Rejected") => true,
        ("Rejected", "Draft") => true,
        ("Draft" or "Rejected" or "Approved", "Voided") => true,
        _ => null,
    };
    public static bool CanTransitionInvoice(string from, string to, string? reason) =>
        InvoiceTransitionNeedsReason(from, to) is { } needsReason && (!needsReason || ValidReason(reason));

    /// <summary>
    /// The Finance code a supplier invoice decision requires: approving or rejecting a submitted invoice is an approval,
    /// voiding an approved one is a reversal (4-N03, like <c>finance.receipts.reverse</c>), and the rest edits the draft.
    /// </summary>
    public static string InvoiceDecisionPermission(string from, string to) => (from, to) switch
    {
        ("Submitted", "Approved" or "Rejected") => "finance.payables.approve",
        ("Approved", "Voided") => "finance.payables.reverse",
        _ => "finance.payables.update",
    };

    /// <summary>4-N14: who created or submitted a supplier invoice does not approve it (compared by person).</summary>
    public static bool CanApproveInvoice(long approverPerson, long creatorPerson, IEnumerable<long> submitterPersons) =>
        approverPerson != creatorPerson && !submitterPersons.Contains(approverPerson);

    /// <summary>
    /// 4-N14: who approved a supplier invoice neither applies a payment to it nor recorded that payment (compared by
    /// person). An invoice without a recorded approver (legacy data) is not restricted.
    /// </summary>
    public static bool CanSettleInvoice(long payerPerson, long paymentCreatorPerson, long? approverPerson) =>
        approverPerson is not { } approver || payerPerson != approver && paymentCreatorPerson != approver;
}
