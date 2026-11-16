using Elevant.Domain.Entities.Commercial;

namespace Elevant.Application.Commercial;

public static class ContractRateConfirmationPolicy
{
    public static bool CanActivate(IReadOnlyCollection<ContractServiceRate> rates) =>
        rates.Count > 0 && rates.All(rate => rate.IsConfirmed == true);
}
