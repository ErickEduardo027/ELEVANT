using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations.MapFlights;

/// <summary>What the actual time of a map flight is (ADR-0042, contracts 1.3).</summary>
public static class MapFlightActualKinds
{
    /// <summary>
    /// The wheels on the runway: the time the feed or the demo progress worker wrote on a leg that is still the provider's,
    /// the runway time of a proposal, or the touchdown and take-off of a demo flight nobody imported.
    /// </summary>
    public const string Runway = "Runway";

    /// <summary>The aircraft on its stand: the time OCC recorded with «Registrar llegada», or a leg of another source.</summary>
    public const string OnBlock = "OnBlock";
}

/// <summary>
/// Where a flight of the map stands, in one closed list of words (ADR-0042, contracts 1.3). Pure: the same provider text,
/// times and instant always give the same phase.
/// </summary>
public static class MapFlightPhases
{
    public const string Scheduled = "scheduled";
    public const string Departed = "departed";
    public const string EnRoute = "enroute";
    public const string Approaching = "approaching";
    public const string Landed = "landed";
    public const string Arrived = "arrived";
    public const string Cancelled = "cancelled";
    public const string Diverted = "diverted";
    public const string Unknown = "unknown";

    /// <summary>Every phase a map flight can have.</summary>
    public static IReadOnlyList<string> All { get; } =
        [Scheduled, Departed, EnRoute, Approaching, Landed, Arrived, Cancelled, Diverted, Unknown];

    /// <summary>
    /// The provider's words for a flight that has not flown its leg to the station yet, or not left it (the statuses
    /// AeroDataBox reports, which the demo flights use too). A leg OCC typed has no provider text and reads as
    /// <c>Unknown</c>.
    /// </summary>
    private static readonly HashSet<string> Waiting = new(StringComparer.OrdinalIgnoreCase)
    {
        "Expected", "Unknown", "CheckIn", "Boarding", "GateClosed", "Delayed",
    };

    /// <summary>
    /// The phase of a leg at <paramref name="now"/>. An actual time decides first: a runway time is <c>landed</c> for an
    /// arrival and <c>departed</c> for a departure; an on-block time is <c>arrived</c> and <c>departed</c>. Without one, the
    /// provider's text decides, in any case and without the spaces around it:
    /// <list type="bullet">
    /// <item>Expected, Unknown, CheckIn, Boarding, GateClosed and Delayed, or no text: <c>scheduled</c>, except an arrival
    /// whose time (the estimated one, else the scheduled one) has come, which is <c>enroute</c>;</item>
    /// <item>Departed: <c>departed</c>; EnRoute: <c>enroute</c>; Approaching: <c>approaching</c>; Arrived: <c>arrived</c>;</item>
    /// <item>Canceled, Cancelled and CanceledUncertain: <c>cancelled</c>; Diverted: <c>diverted</c>;</item>
    /// <item>any other word: <c>unknown</c>.</item>
    /// </list>
    /// </summary>
    /// <param name="direction"><c>Arrival</c> or <c>Departure</c>, in any case.</param>
    /// <param name="providerStatus">The provider's word for the flight; null for a leg nobody reports.</param>
    /// <param name="scheduledAt">The scheduled time at the station.</param>
    /// <param name="estimatedAt">The estimated (or revised) time at the station.</param>
    /// <param name="actualAt">The actual time at the station.</param>
    /// <param name="actualKind">What <paramref name="actualAt"/> is (<see cref="MapFlightActualKinds"/>).</param>
    /// <param name="now">The instant the phase is asked for.</param>
    public static string Of(string direction, string? providerStatus, DateTimeOffset scheduledAt, DateTimeOffset? estimatedAt,
        DateTimeOffset? actualAt, string? actualKind, DateTimeOffset now)
    {
        var arrival = IsArrival(direction);
        if (actualAt is not null)
        {
            if (string.Equals(actualKind, MapFlightActualKinds.Runway, StringComparison.OrdinalIgnoreCase))
                return arrival ? Landed : Departed;
            if (string.Equals(actualKind, MapFlightActualKinds.OnBlock, StringComparison.OrdinalIgnoreCase))
                return arrival ? Arrived : Departed;
        }

        var text = providerStatus?.Trim();
        if (string.IsNullOrEmpty(text) || Waiting.Contains(text))
            return arrival && now >= (estimatedAt ?? scheduledAt) ? EnRoute : Scheduled;
        return text.ToUpperInvariant() switch
        {
            "DEPARTED" => Departed,
            "ENROUTE" => EnRoute,
            "APPROACHING" => Approaching,
            "ARRIVED" => Arrived,
            "CANCELED" or "CANCELLED" or "CANCELEDUNCERTAIN" => Cancelled,
            "DIVERTED" => Diverted,
            _ => Unknown,
        };
    }

    private static bool IsArrival(string direction)
    {
        if (string.Equals(direction, nameof(FlightDirection.Arrival), StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(direction, nameof(FlightDirection.Departure), StringComparison.OrdinalIgnoreCase)) return false;
        throw new ArgumentOutOfRangeException(nameof(direction), direction, "A flight leg is an Arrival or a Departure.");
    }
}
