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

    [Fact]
    public void MoneyAndQuantitiesMustFitTheirStoredScale()
    {
        Assert.False(FinancePayablesPolicy.Money(1.00001m));
        Assert.False(FinancePayablesPolicy.Quantity(100000000000000m));
        Assert.True(FinancePayablesPolicy.Quantity(0.0001m));
        Assert.Equal(30.0003m, FinancePayablesPolicy.LineTotal(3m, 10.0001m, 0m));
    }
}
