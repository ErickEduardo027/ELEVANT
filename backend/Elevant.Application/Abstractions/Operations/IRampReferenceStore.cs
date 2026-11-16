namespace Elevant.Application.Abstractions.Operations;

/// <summary>An active aircraft type of the shared catalog, as the tablet offers it (3-B).</summary>
public sealed record RampAircraftTypeData(Guid Id, string IcaoCode, string? IataCode, string Manufacturer, string Model);

/// <summary>Reference data the ramp agent's tablet reads (3-B); the tablet keeps it only as a cache.</summary>
public interface IRampReferenceStore
{
    /// <summary>The active aircraft types by manufacturer and model; null when the caller is not a ramp agent.</summary>
    Task<IReadOnlyList<RampAircraftTypeData>?> ListAircraftTypesAsync(Guid actorId,
        CancellationToken cancellationToken = default);
}
