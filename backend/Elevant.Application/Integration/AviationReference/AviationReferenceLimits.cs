namespace Elevant.Application.Integration.AviationReference;

/// <summary>The paid reference reads of the aviation data provider (ADR-0028, note of 15 November 2026).</summary>
public enum AviationReferenceKind
{
    /// <summary><c>GET /airlines/{code}/aircrafts</c>, tier 3.</summary>
    AirlineFleet,

    /// <summary><c>GET /aircrafts/reg/{registration}</c>, tier 1.</summary>
    Aircraft,

    /// <summary><c>GET /airports/icao/{code}/stats/routes/daily</c>, tier 3.</summary>
    AirportRoutes,

    /// <summary><c>GET /airports/{iata|icao}/{code}/delays</c>, tier 3.</summary>
    AirportDelays,
}

/// <summary>
/// What one read may spend: the units a call costs at the provider, the units it may spend in a UTC day and in a UTC
/// month, and how long an answer is kept before it is asked again.
/// </summary>
public sealed record AviationReferenceCap(int UnitsPerCall, int DailyUnits, int MonthlyUnits, TimeSpan CacheFor);

/// <summary>
/// The caps of every reference read and the ceiling they share with the flight feed: a call that would take the units
/// of every operation of the provider this month past <paramref name="ProviderMonthlyUnits"/> is not made.
/// </summary>
public sealed record AviationReferenceLimits(
    AviationReferenceCap AirlineFleet,
    AviationReferenceCap Aircraft,
    AviationReferenceCap AirportRoutes,
    AviationReferenceCap AirportDelays,
    int ProviderMonthlyUnits)
{
    /// <summary>
    /// Conservative defaults for the Starter plan (40 000 units a month): at most 3 200 units a month for the four reads
    /// together, next to the flight feed's own budget.
    /// </summary>
    public static AviationReferenceLimits Default { get; } = new(
        new AviationReferenceCap(6, 30, 300, TimeSpan.FromDays(7)),
        new AviationReferenceCap(1, 40, 1200, TimeSpan.FromDays(1)),
        new AviationReferenceCap(6, 12, 200, TimeSpan.FromHours(24)),
        new AviationReferenceCap(6, 48, 1500, TimeSpan.FromHours(1)),
        38000);

    public AviationReferenceCap For(AviationReferenceKind kind) => kind switch
    {
        AviationReferenceKind.AirlineFleet => AirlineFleet,
        AviationReferenceKind.Aircraft => Aircraft,
        AviationReferenceKind.AirportRoutes => AirportRoutes,
        _ => AirportDelays,
    };

    /// <summary>The operation the usage ledger records for each read.</summary>
    public static string Operation(AviationReferenceKind kind) => kind switch
    {
        AviationReferenceKind.AirlineFleet => "airline_fleet",
        AviationReferenceKind.Aircraft => "aircraft",
        AviationReferenceKind.AirportRoutes => "airport_routes",
        _ => "airport_delays",
    };
}

/// <summary>
/// The state of a reference read, which every answer carries in its 200: never an error for the screens.
/// </summary>
public enum AviationReferenceStatus
{
    /// <summary>The provider answered; the value may come from the cache.</summary>
    Available,

    /// <summary>The provider answered that it has nothing for this airline, aircraft or airport.</summary>
    NotFound,

    /// <summary>No provider is configured here: nothing is called.</summary>
    Disabled,

    /// <summary>The read spent its units of the UTC day; the last value kept may come with it.</summary>
    DailyLimitReached,

    /// <summary>The read, or the provider, spent its units of the UTC month; the last value kept may come with it.</summary>
    MonthlyLimitReached,

    /// <summary>The provider failed or is being waited out; the last value kept may come with it.</summary>
    Unavailable,

    /// <summary>The subject is not the provider's to answer: a demo flight's synthetic registration.</summary>
    NotApplicable,
}

/// <summary>A reference read: its state, its value (null when there is none) and when the provider gave it.</summary>
public sealed record AviationReferenceRead<T>(AviationReferenceStatus Status, T? Value, DateTimeOffset? RetrievedAt)
    where T : class;
