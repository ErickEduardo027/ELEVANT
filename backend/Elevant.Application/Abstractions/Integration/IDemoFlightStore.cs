using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration.DemoFlights;

namespace Elevant.Application.Abstractions.Integration;

/// <summary>
/// Persistence of the demo flights the superadministrator triggers (ADR-0041): two proposals of the provider
/// <see cref="DemoFlightProvider.Name"/> that OCC imports like any other flight. Nothing is ever deleted.
/// </summary>
public interface IDemoFlightStore
{
    /// <summary>What the trigger form offers at a station; null when the caller is not the superadministrator.</summary>
    Task<DemoFlightOptionsData?> OptionsAsync(Guid actorId, Guid? stationId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The demo flights of the last 24 hours, newest first, at most 50; null when the caller is not the
    /// superadministrator.
    /// </summary>
    Task<DemoFlightListData?> ListAsync(Guid actorId, Guid? stationId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Triggers a demo flight. The same Idempotency-Key with the same request answers the first flight again
    /// (<see cref="MasterDataResult{T}.Replayed"/>) without a second pair, audit entry or announcement.
    /// </summary>
    Task<MasterDataResult<DemoFlightData>> CreateAsync(Guid actorId, CreateDemoFlightInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Ends a demo flight: <see cref="DemoFlightIntent.Cancel"/> before touchdown (a provider cancellation),
    /// <see cref="DemoFlightIntent.Finish"/> after it (the off-block comes forward). The intent is checked against the
    /// phase the flight is in.
    /// </summary>
    Task<MasterDataResult<DemoFlightData>> CancelAsync(Guid actorId, Guid demoFlightId, DemoFlightIntent intent,
        Guid idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// The progress worker's tick: writes what the clock reached at <paramref name="now"/> and answers how many demo
    /// flights changed.
    /// </summary>
    Task<int> AdvanceAsync(DateTimeOffset now, CancellationToken cancellationToken = default);
}
