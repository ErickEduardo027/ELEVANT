using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;

namespace Elevant.UnitTests.Application;

public sealed class ContractRateConfirmationPolicyTests
{
    [Fact]
    public void PendingAndLegacyDraftRatesCannotBeActivated()
    {
        Assert.False(ContractRateConfirmationPolicy.CanActivate(
            [new ContractServiceRate { IsConfirmed = false }]));
        Assert.False(ContractRateConfirmationPolicy.CanActivate(
            [new ContractServiceRate { IsConfirmed = null }]));
    }

    [Fact]
    public void AnExplicitlyConfirmedCourtesyRateCanBeActivated()
    {
        Assert.True(ContractRateConfirmationPolicy.CanActivate(
            [new ContractServiceRate { IsConfirmed = true, UnitPrice = 0 }]));
    }
}
