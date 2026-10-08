using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Reads and commits the device-scoped charges a ramp agent marks on executed services.</summary>
public interface IRampServiceChargeStore
{
    Task<RampOperationChargesData?> ReadAsync(Guid accountId, IReadOnlyList<Guid> allowedStationIds, Guid operationId,
        Guid installationId, CancellationToken cancellationToken = default);

    Task<RampServiceChargeWriteResult> ApplyAsync(RampServiceChargeWriteRequest request,
        CancellationToken cancellationToken = default);
}
