using Elevant.Application.Operations;

namespace Elevant.Application.Abstractions.Operations;

public interface IOccShiftProgrammingStore
{
    Task<OccShiftWriteResult> ProgramAsync(
        OccShiftWriteRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The shift of an agent on the day of a flight of the actor's stations (3-E), with its version, so OCC adjusts it
    /// instead of programming a second one; <c>ShiftNotFound</c> when the agent has none that day at that station.
    /// </summary>
    Task<OccAgentShiftReadResult> GetAgentShiftAsync(
        OccAgentShiftReadRequest request,
        CancellationToken cancellationToken = default);
}
