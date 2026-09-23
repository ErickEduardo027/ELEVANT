using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IRampIncidentStore
{
    Task<RampIncidentReadResult> GetAsync(
        RampIncidentReadRequest request,
        CancellationToken cancellationToken = default);

    Task<RampIncidentWriteResult> ReportAsync(
        RampIncidentWriteRequest request,
        CancellationToken cancellationToken = default);
}
