using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IOccShiftProgrammingStore
{
    Task<OccShiftWriteResult> ProgramAsync(
        OccShiftWriteRequest request,
        CancellationToken cancellationToken = default);
}
