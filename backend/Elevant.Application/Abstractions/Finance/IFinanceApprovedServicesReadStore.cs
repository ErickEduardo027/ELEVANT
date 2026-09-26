using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IFinanceApprovedServicesReadStore
{
    Task<FinanceApprovedServicesData?> GetAsync(
        Guid accountId,
        Guid stationId,
        DateOnly startDate,
        DateOnly endDate,
        CancellationToken cancellationToken = default);
}
