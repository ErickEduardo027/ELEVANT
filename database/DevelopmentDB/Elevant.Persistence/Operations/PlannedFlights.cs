using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// 3-N07: the same flight of an airline on the same local day of a station is planned once, whether OCC types it,
/// reschedules it or the feed imports it; a second turnaround would be operated and invoiced twice. The flight is an
/// open turnaround (not cancelled, diverted or completed) with a leg of the same normalized number in the same direction
/// (<see cref="FlightIdentity"/>).
/// </summary>
internal static class PlannedFlights
{
    /// <summary>
    /// Whether another open turnaround of the airline already flies <paramref name="arrivalNumber"/> in or
    /// <paramref name="departureNumber"/> out on <paramref name="operationDate"/>. Both numbers come normalized;
    /// <paramref name="exceptTurnaroundId"/> is the turnaround being rescheduled, which never duplicates itself.
    /// </summary>
    public static async Task<bool> ExistsAsync(ElevantDbContext context, long stationId, long airlineId,
        DateOnly operationDate, string arrivalNumber, string departureNumber, long? exceptTurnaroundId,
        CancellationToken cancellationToken)
    {
        var turnarounds = context.Turnarounds.AsNoTracking().Where(turnaround => turnaround.StationId == stationId &&
            turnaround.AirlineId == airlineId && turnaround.OperationDate == operationDate &&
            turnaround.CurrentStatus != TurnaroundStatus.Cancelled &&
            turnaround.CurrentStatus != TurnaroundStatus.Diverted &&
            turnaround.CurrentStatus != TurnaroundStatus.Completed);
        if (exceptTurnaroundId is { } except) turnarounds = turnarounds.Where(turnaround => turnaround.Id != except);
        var legs = await (from turnaround in turnarounds
                          join leg in context.FlightLegs.AsNoTracking() on turnaround.Id equals leg.TurnaroundId
                          select new { leg.Direction, leg.FlightNumber })
            .ToArrayAsync(cancellationToken);
        return legs.Any(leg => FlightIdentity.NormalizeFlightNumber(leg.FlightNumber) ==
            (leg.Direction == FlightDirection.Arrival ? arrivalNumber : departureNumber));
    }
}
