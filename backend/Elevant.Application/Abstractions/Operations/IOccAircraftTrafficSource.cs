using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>Reads bounded, current provider observations without persisting them.</summary>
public interface IOccAircraftTrafficSource
{
    Task<OccAircraftTrafficData?> ReadAsync(CancellationToken cancellationToken = default);
}
