using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class FinancePayablesPolicyTests
{
    [Fact]
    public void OwnExpenseAccessUsesActiveEmployeeAndInternalMembershipWithoutFinanceGrants()
    {
        var actor = new ActorContext(Guid.NewGuid(), "member@example.invalid", "Synthetic member", [],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "Synthetic operator", OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(Guid.NewGuid(), "PUJ")],
            new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Contracts, new HashSet<string>()));
        Assert.False(actor.HasPermission("finance.expenses.manage"));
        Assert.True(FinancePayablesPolicy.CanUseOwnExpenses(actor, true));
        Assert.False(FinancePayablesPolicy.CanUseOwnExpenses(actor, false));
        Assert.False(FinancePayablesPolicy.CanUseOwnExpenses(actor with { Memberships = [] }, true));
        Assert.False(FinancePayablesPolicy.CanUseOwnExpenses(actor with { StationScopes = [] }, true));
    }

    [Fact]
    public void MissingFxNeverBecomesAnImplicitRate()
    {
        Assert.False(FinancePayablesPolicy.ValidFx("USD", null, "", null));
        Assert.False(FinancePayablesPolicy.ValidFx("EUR", 60m, "Synthetic", new DateOnly(2026, 10, 18)));
        Assert.False(FinancePayablesPolicy.ValidFx("DOP", 60m, "Synthetic", new DateOnly(2026, 10, 18)));
        Assert.True(FinancePayablesPolicy.ValidFx("USD", 60m, "Synthetic", new DateOnly(2026, 10, 18)));
    }

    [Fact]
    public void ApplicationsPreservePaymentRemainderAndRejectOverapplication()
    {
        Assert.Equal(700m, FinancePayablesPolicy.Remaining(1000m, [300m]));
        Assert.False(FinancePayablesPolicy.CanApply(700m, 1000m, 701m, 1m));
        Assert.False(FinancePayablesPolicy.CanApply(1000m, 700m, 701m, 1m));
        Assert.True(FinancePayablesPolicy.CanApply(700m, 300m, 300m, 1m));
        Assert.True(FinancePayablesPolicy.CanApply(6000m, 100m, 6000m, 1m / 60m));
        Assert.False(FinancePayablesPolicy.CanApply(100m, 100m, 100m, null));
    }

    [Fact]
    public void ApprovalRequiresOwnDepartmentAdministratorAndNeverSelf()
    {
        var requester = Guid.NewGuid();
        var reviewer = Guid.NewGuid();
        var admin = new DepartmentAccess(DepartmentAssignmentKind.Administrator, Department.Operations, new HashSet<string>());
        Assert.True(FinancePayablesPolicy.CanReviewDepartment(reviewer, requester, admin, Department.Operations));
        Assert.False(FinancePayablesPolicy.CanReviewDepartment(requester, requester, admin, Department.Operations));
        Assert.False(FinancePayablesPolicy.CanReviewDepartment(reviewer, requester, admin, Department.Contracts));
        Assert.False(FinancePayablesPolicy.CanReviewDepartment(reviewer, requester,
            admin with { Kind = DepartmentAssignmentKind.Member }, Department.Operations));
    }

    [Theory]
    [InlineData("Submitted", "Approved", false)]
    [InlineData("Submitted", "DepartmentApproved", true)]
    [InlineData("DepartmentApproved", "Approved", true)]
    [InlineData("Draft", "Approved", false)]
    [InlineData("Approved", "Rejected", false)]
    public void ExpenseApprovalStagesCannotBeSkipped(string from, string to, bool valid) =>
        Assert.Equal(valid, FinancePayablesPolicy.CanTransitionExpense(from, to, "A documented reason"));

    [Fact]
    public void RejectionNeedsReasonAndPostedSupplierInvoiceCannotBeEdited()
    {
        Assert.False(FinancePayablesPolicy.CanTransitionExpense("Submitted", "Rejected", " "));
        Assert.False(FinancePayablesPolicy.CanTransitionInvoice("Approved", "Draft", null));
        Assert.True(FinancePayablesPolicy.CanTransitionInvoice("Draft", "Submitted", null));
        Assert.True(FinancePayablesPolicy.CanTransitionInvoice("Submitted", "Approved", null));
    }

    /// <summary>Phase 4: a reason has 5 to 500 characters once trimmed; an optional note only fits its column.</summary>
    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("  Mal  ", false)]
    [InlineData("Error", true)]
    [InlineData("  NCF digitado con un error  ", true)]
    public void AReasonHasFiveToFiveHundredCharacters(string? reason, bool valid)
    {
        Assert.Equal(valid, FinancePayablesPolicy.ValidReason(reason));
        Assert.True(FinancePayablesPolicy.ValidOptionalReason(reason));
    }

    [Fact]
    public void AReasonLongerThanFiveHundredCharactersIsRefusedEvenWhenOptional()
    {
        Assert.True(FinancePayablesPolicy.ValidReason(new string('x', 500)));
        Assert.False(FinancePayablesPolicy.ValidReason(new string('x', 501)));
        Assert.False(FinancePayablesPolicy.ValidOptionalReason(new string('x', 501)));
        Assert.True(FinancePayablesPolicy.ValidOptionalReason(" " + new string('x', 500) + " "));
    }

    /// <summary>
    /// 4-N03: a rejected invoice returns to Draft to be corrected; a draft, a rejected or an approved invoice is voided with
    /// a reason; a submitted one is approved or rejected first and an approved one never returns to Draft.
    /// </summary>
    [Theory]
    [InlineData("Draft", "Submitted", false)]
    [InlineData("Submitted", "Approved", false)]
    [InlineData("Submitted", "Rejected", true)]
    [InlineData("Rejected", "Draft", true)]
    [InlineData("Draft", "Voided", true)]
    [InlineData("Rejected", "Voided", true)]
    [InlineData("Approved", "Voided", true)]
    [InlineData("Submitted", "Voided", null)]
    [InlineData("Approved", "Draft", null)]
    [InlineData("Approved", "Rejected", null)]
    [InlineData("Voided", "Draft", null)]
    [InlineData("Voided", "Voided", null)]
    [InlineData("Draft", "Approved", null)]
    [InlineData("Rejected", "Submitted", null)]
    public void SupplierInvoiceCorrectionsAreStatusChangesWithTheirReason(string from, string to, bool? needsReason)
    {
        Assert.Equal(needsReason, FinancePayablesPolicy.InvoiceTransitionNeedsReason(from, to));
        Assert.Equal(needsReason is not null, FinancePayablesPolicy.CanTransitionInvoice(from, to, "Referencia digitada con error"));
        if (needsReason == true) Assert.False(FinancePayablesPolicy.CanTransitionInvoice(from, to, "Mal"));
    }

    [Theory]
    [InlineData("Draft", "Submitted", "finance.payables.update")]
    [InlineData("Submitted", "Approved", "finance.payables.approve")]
    [InlineData("Submitted", "Rejected", "finance.payables.approve")]
    [InlineData("Rejected", "Draft", "finance.payables.update")]
    [InlineData("Draft", "Voided", "finance.payables.update")]
    [InlineData("Rejected", "Voided", "finance.payables.update")]
    [InlineData("Approved", "Voided", "finance.payables.reverse")]
    public void EachSupplierInvoiceDecisionNeedsItsFinanceCode(string from, string to, string permission) =>
        Assert.Equal(permission, FinancePayablesPolicy.InvoiceDecisionPermission(from, to));

    /// <summary>
    /// 4-N13: the requester withdraws a claim the department has not decided, corrects a rejected one and discards a draft
    /// or a rejected one; every one of those keeps a reason. A decided claim is never withdrawn.
    /// </summary>
    [Theory]
    [InlineData("Submitted", "Draft", true)]
    [InlineData("Rejected", "Draft", true)]
    [InlineData("Draft", "Cancelled", true)]
    [InlineData("Rejected", "Cancelled", true)]
    [InlineData("DepartmentApproved", "Draft", null)]
    [InlineData("Approved", "Draft", null)]
    [InlineData("Submitted", "Cancelled", null)]
    [InlineData("Approved", "Cancelled", null)]
    [InlineData("Cancelled", "Draft", null)]
    [InlineData("Draft", "Submitted", false)]
    [InlineData("DepartmentApproved", "Rejected", true)]
    public void EmployeeExpenseCorrectionsAreStatusChangesWithTheirReason(string from, string to, bool? needsReason)
    {
        Assert.Equal(needsReason, FinancePayablesPolicy.ExpenseTransitionNeedsReason(from, to));
        Assert.Equal(needsReason is not null, FinancePayablesPolicy.CanTransitionExpense(from, to, "Comprobante equivocado"));
        if (needsReason == true) Assert.False(FinancePayablesPolicy.CanTransitionExpense(from, to, null));
    }

    [Theory]
    [InlineData(true, true, "Department")]
    [InlineData(true, false, "Department")]
    [InlineData(false, true, "Finance")]
    [InlineData(false, false, "None")]
    public void AnExpenseWithoutDepartmentReviewerEscalatesToFinance(bool department, bool finance, string route) =>
        Assert.Equal(route, FinancePayablesPolicy.ExpenseReviewRoute(department, finance));

    /// <summary>4-N13: only a Finance administrator who did not file the expense reviews it by escalation.</summary>
    [Fact]
    public void OnlyAnotherFinanceAdministratorReviewsAnEscalatedExpense()
    {
        var requester = Guid.NewGuid();
        var reviewer = Guid.NewGuid();
        var finance = new DepartmentAccess(DepartmentAssignmentKind.Administrator, Department.Finance, new HashSet<string>());
        Assert.True(FinancePayablesPolicy.CanEscalateExpenseReview(reviewer, requester, finance));
        Assert.False(FinancePayablesPolicy.CanEscalateExpenseReview(requester, requester, finance));
        Assert.False(FinancePayablesPolicy.CanEscalateExpenseReview(reviewer, requester, finance with { Kind = DepartmentAssignmentKind.Member }));
        Assert.False(FinancePayablesPolicy.CanEscalateExpenseReview(reviewer, requester, finance with { Department = Department.Operations }));
        Assert.False(FinancePayablesPolicy.CanEscalateExpenseReview(reviewer, requester,
            finance with { Kind = DepartmentAssignmentKind.SuperAdministrator, Department = null }));
        Assert.False(FinancePayablesPolicy.CanEscalateExpenseReview(reviewer, requester, null));
    }

    /// <summary>4-N14: who creates or submits a supplier invoice does not approve it.</summary>
    [Theory]
    [InlineData(1L, 2L, new long[] { 3 }, true)]
    [InlineData(1L, 1L, new long[] { 3 }, false)]
    [InlineData(1L, 2L, new long[] { 3, 1 }, false)]
    [InlineData(1L, 2L, new long[0], true)]
    public void TheCreatorOrASubmitterNeverApprovesTheInvoice(long approver, long creator, long[] submitters, bool allowed) =>
        Assert.Equal(allowed, FinancePayablesPolicy.CanApproveInvoice(approver, creator, submitters));

    /// <summary>4-N14: who approved a supplier invoice neither applies a payment to it nor recorded that payment.</summary>
    [Theory]
    [InlineData(1L, 2L, 3L, true)]
    [InlineData(3L, 2L, 3L, false)]
    [InlineData(1L, 3L, 3L, false)]
    [InlineData(3L, 3L, null, true)]
    public void TheApproverNeverPaysTheInvoice(long payer, long paymentCreator, long? approver, bool allowed) =>
        Assert.Equal(allowed, FinancePayablesPolicy.CanSettleInvoice(payer, paymentCreator, approver));

    [Fact]
    public void MoneyAndQuantitiesMustFitTheirStoredScale()
    {
        Assert.False(FinancePayablesPolicy.Money(1.00001m));
        Assert.False(FinancePayablesPolicy.Quantity(100000000000000m));
        Assert.True(FinancePayablesPolicy.Quantity(0.0001m));
        Assert.Equal(30.0003m, FinancePayablesPolicy.LineTotal(3m, 10.0001m, 0m));
    }
}
