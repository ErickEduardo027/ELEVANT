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
    public void AllowedTransitions(ContractLifecycleAction action, ContractStatus from, ContractStatus to) =>
        Assert.Equal(to, ContractLifecycle.Target(action, from));

    [Theory]
    [InlineData(ContractLifecycleAction.Suspend, ContractStatus.Draft)]
    [InlineData(ContractLifecycleAction.Reactivate, ContractStatus.Active)]
    [InlineData(ContractLifecycleAction.Terminate, ContractStatus.Terminated)]
    [InlineData(ContractLifecycleAction.Renew, ContractStatus.Draft)]
    [InlineData(ContractLifecycleAction.Renew, ContractStatus.Terminated)]
    public void ForbiddenTransitions(ContractLifecycleAction action, ContractStatus from) =>
        Assert.Null(ContractLifecycle.Target(action, from));
}
