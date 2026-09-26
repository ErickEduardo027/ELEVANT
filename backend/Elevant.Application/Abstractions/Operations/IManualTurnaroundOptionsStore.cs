using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IManualTurnaroundOptionsStore
{
    Task<ManualTurnaroundOptionsData?> GetAsync(
        Guid accountId, Guid stationId, DateOnly operationDate,
        CancellationToken cancellationToken = default);
}
