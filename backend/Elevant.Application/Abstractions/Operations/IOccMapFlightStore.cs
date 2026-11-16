using Elevant.Application.Operations.MapFlights;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// The ELEVANT flights of a station for the map (ADR-0042, contracts 1.3). Who may read them is the caller's to decide:
/// the store answers for the station it is asked about.
/// </summary>
public interface IOccMapFlightStore
{
    /// <summary>
    /// One row per leg of the station's turnarounds that are neither cancelled nor diverted, when the leg's best time
    /// (actual, else estimated, else scheduled) is in [<paramref name="windowFrom"/>, <paramref name="windowTo"/>] or its
    /// aircraft is on the ground at <paramref name="now"/>; and one per open proposal of the feed, of an airline OCC's
    /// review shows, whose best time is in the window. Sorted by best time and then flight number. Phases and demo clocks
    /// are resolved at <paramref name="now"/>. Null when the station is unknown or inactive.
    /// </summary>
    Task<OccMapFlightsData?> ListAsync(Guid stationId, DateTimeOffset windowFrom, DateTimeOffset windowTo,
        DateTimeOffset now, CancellationToken cancellationToken = default);
}
