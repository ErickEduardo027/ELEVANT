using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IManualTurnaroundStore
{
    Task<ManualTurnaroundWriteResult> CreateAsync(
        ManualTurnaroundWriteRequest request,
        CancellationToken cancellationToken = default);
}
