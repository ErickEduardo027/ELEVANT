using Elevant.Application.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class ContractLifecycleTests
{
    private static readonly DateOnly Today = new(2026, 11, 2);

    [Theory]
    [InlineData(-1, PermitValidity.Expired)]
    [InlineData(0, PermitValidity.Expiring)]
    [InlineData(30, PermitValidity.Expiring)]
    [InlineData(31, PermitValidity.Current)]
    public void PermitValidityIsComputedFromItsExpiry(int days, PermitValidity expected) =>
        Assert.Equal(expected, ContractLifecycle.Validity(Today.AddDays(days), Today));

    [Fact]
    public void OnlyAVerifiedCurrentOperatingPermitCounts()
    {
        Assert.True(ContractLifecycle.IsUsable(AirlinePermitKind.OperatingPermit, AirlinePermitReview.Verified, Today, Today));
        Assert.False(ContractLifecycle.IsUsable(AirlinePermitKind.OperatingPermit, AirlinePermitReview.Submitted, Today, Today));
        Assert.False(ContractLifecycle.IsUsable(AirlinePermitKind.Insurance, AirlinePermitReview.Verified, Today, Today));
        Assert.False(ContractLifecycle.IsUsable(AirlinePermitKind.OperatingPermit, AirlinePermitReview.Verified, Today.AddDays(-1), Today));
    }

    [Theory]
    [InlineData(ContractLifecycleAction.Suspend, ContractStatus.Active, ContractStatus.Suspended)]
    [InlineData(ContractLifecycleAction.Reactivate, ContractStatus.Suspended, ContractStatus.Active)]
    [InlineData(ContractLifecycleAction.Terminate, ContractStatus.Expired, ContractStatus.Terminated)]
    // «Descartar contrato»: a contract that never activated is closed (1-B).
    [InlineData(ContractLifecycleAction.Terminate, ContractStatus.Draft, ContractStatus.Terminated)]
    [InlineData(ContractLifecycleAction.Renew, ContractStatus.Active, ContractStatus.Active)]
    [InlineData(ContractLifecycleAction.Renew, ContractStatus.Expired, ContractStatus.Expired)]
    [InlineData(ContractLifecycleAction.CancelTermination, ContractStatus.Active, ContractStatus.Active)]
    [InlineData(ContractLifecycleAction.CancelTermination, ContractStatus.Suspended, ContractStatus.Suspended)]
    [InlineData(ContractLifecycleAction.CancelTermination, ContractStatus.Expired, ContractStatus.Expired)]
    public void AllowedTransitions(ContractLifecycleAction action, ContractStatus from, ContractStatus to) =>
        Assert.Equal(to, ContractLifecycle.Target(action, from));

    [Theory]
    [InlineData(ContractLifecycleAction.Suspend, ContractStatus.Draft)]
    [InlineData(ContractLifecycleAction.Reactivate, ContractStatus.Active)]
    [InlineData(ContractLifecycleAction.Terminate, ContractStatus.Terminated)]
    [InlineData(ContractLifecycleAction.Renew, ContractStatus.Draft)]
    [InlineData(ContractLifecycleAction.Renew, ContractStatus.Terminated)]
    [InlineData(ContractLifecycleAction.CancelTermination, ContractStatus.Terminated)]
    [InlineData(ContractLifecycleAction.CancelTermination, ContractStatus.Draft)]
    public void ForbiddenTransitions(ContractLifecycleAction action, ContractStatus from) =>
        Assert.Null(ContractLifecycle.Target(action, from));

    [Theory]
    // A contract that never activated, or one already expired, ends at once (2-N14).
    [InlineData(ContractStatus.Draft, null, null, 30)]
    [InlineData(ContractStatus.Expired, 90, null, 30)]
    // An explicit cause with its note ends an active or suspended contract at once.
    [InlineData(ContractStatus.Active, null, "Breach", 30)]
    [InlineData(ContractStatus.Suspended, null, "MutualAgreement", 30)]
    [InlineData(ContractStatus.Active, 0, null, 0)]
    public void ATerminationCanTakeEffectToday(ContractStatus status, int? days, string? cause, int notice)
    {
        var (plan, issue) = ContractLifecycle.PlanTermination(status, Today,
            days is { } offset ? Today.AddDays(offset) : null, cause, notice, null);
        Assert.Null(issue);
        Assert.Equal(new ContractTerminationPlan(Today, true), plan);
    }

    [Fact]
    public void AnActiveContractRespectsTheSignedNotice()
    {
        // The first day without coverage is no earlier than today plus the notice of the version in force.
        Assert.Equal((null, ContractLifecycleIssues.TerminationNoticeNotMet), ContractLifecycle.PlanTermination(
            ContractStatus.Active, Today, Today.AddDays(29), null, 30, null));
        Assert.Equal((new ContractTerminationPlan(Today.AddDays(30), false), null), ContractLifecycle.PlanTermination(
            ContractStatus.Active, Today, Today.AddDays(30), null, 30, null));
        Assert.Equal((null, ContractLifecycleIssues.TerminationDateRequired), ContractLifecycle.PlanTermination(
            ContractStatus.Suspended, Today, null, null, 30, null));
        Assert.Equal((null, ContractLifecycleIssues.ImmediateCauseInvalid), ContractLifecycle.PlanTermination(
            ContractStatus.Active, Today, null, "Cansancio", 30, null));
        // A scheduled termination is cancelled before another date; an immediate cause still ends it now.
        Assert.Equal((null, ContractLifecycleIssues.TerminationScheduled), ContractLifecycle.PlanTermination(
            ContractStatus.Active, Today, Today.AddDays(60), null, 30, Today.AddDays(45)));
        Assert.Equal((new ContractTerminationPlan(Today, true), null), ContractLifecycle.PlanTermination(
            ContractStatus.Suspended, Today, null, ContractTerminationCauses.Breach, 30, Today.AddDays(45)));
    }

    [Fact]
    public void NothingStartsOnATerminatedContractOrAfterItsScheduledTermination()
    {
        Assert.Equal(ContractLifecycleIssues.ContractTerminated,
            ContractLifecycle.ClosedFor(ContractStatus.Terminated, Today, Today.AddDays(-30)));
        Assert.Equal(ContractLifecycleIssues.TerminationScheduled,
            ContractLifecycle.ClosedFor(ContractStatus.Active, Today.AddDays(10), Today.AddDays(10)));
        Assert.Null(ContractLifecycle.ClosedFor(ContractStatus.Active, Today.AddDays(10), Today.AddDays(9)));
        Assert.Null(ContractLifecycle.ClosedFor(ContractStatus.Active, null, Today.AddYears(1)));
    }
}
