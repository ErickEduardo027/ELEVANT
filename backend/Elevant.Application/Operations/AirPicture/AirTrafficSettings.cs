using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// How the OCC map reads live air traffic (ADR-0042, contracts 1.3), from the <c>AirTraffic</c> section: the only
/// station with an air picture, the centre and radius of every read, how often the network is read, how long one request
/// keeps the reads going and how long an aircraft's trail is kept. Infrastructure builds it from the configuration and
/// refuses to start with a value out of range.
/// </summary>
public sealed record AirTrafficSettings(bool Enabled, string StationCode, double CenterLatitude, double CenterLongitude,
    int RadiusNm, TimeSpan Interval, TimeSpan IdleAfter, TimeSpan TrailRetention)
{
    /// <summary>Punta Cana, the station of the demonstration.</summary>
    public const string DefaultStationCode = "PUJ";

    /// <summary>The centre of the reads by default: Punta Cana's aerodrome reference point.</summary>
    public const double DefaultCenterLatitude = 18.5674;

    public const double DefaultCenterLongitude = -68.3634;

    /// <summary>The widest radius both networks answer, in nautical miles.</summary>
    public const int MaxRadiusNm = 250;

    /// <summary>The longest an aircraft's trail is kept, in minutes.</summary>
    public const int MaxTrailMinutes = 180;

    /// <summary>The network is never read more often than this, whatever the configuration says.</summary>
    public static TimeSpan MinimumInterval { get; } = TimeSpan.FromSeconds(10);

    /// <summary>How long one request keeps the reads going by default.</summary>
    public static TimeSpan DefaultIdleAfter { get; } = TimeSpan.FromSeconds(900);

    /// <summary>
    /// The settings without a configured network, the default of every host. They keep Punta Cana's area, so a response
    /// can still say where the picture would be.
    /// </summary>
    public static AirTrafficSettings Disabled { get; } = new(false, DefaultStationCode, DefaultCenterLatitude,
        DefaultCenterLongitude, MaxRadiusNm, MinimumInterval, DefaultIdleAfter, TimeSpan.FromMinutes(MaxTrailMinutes));

    /// <summary>The circle every read asks for.</summary>
    public AirTrafficArea Area => new(CenterLatitude, CenterLongitude, RadiusNm);

    /// <summary>The radius of the airfield read by default, in nautical miles (CN-31).</summary>
    public const int DefaultAirfieldRadiusNm = 5;

    /// <summary>
    /// The widest airfield read: the approach. Beyond it the read is no longer the airfield's. Development reads it
    /// (M3, <c>appsettings.Development.json</c>).
    /// </summary>
    public const int MaxAirfieldRadiusNm = 25;

    /// <summary>How often the airfield is read by default (CN-31).</summary>
    public static TimeSpan DefaultAirfieldInterval => TimeSpan.FromSeconds(3);

    /// <summary>
    /// The airfield is never read more often than this, whatever the configuration says. Development reads it this often
    /// (M3, <c>appsettings.Development.json</c>).
    /// </summary>
    public static TimeSpan MinimumAirfieldInterval => TimeSpan.FromSeconds(2);

    /// <summary>
    /// CN-31: whether, between two reads of the whole circle, a smaller circle around the airfield is read more often, so
    /// the aircraft approaching, landing, taxiing and parking carry fresher positions. On by default; it only runs while a
    /// screen watches the map and only against a network without a daily limit (adsb.fi), never adsb.lol's 450 a day. M3:
    /// Development reads the airfield and the approach, 25 NM every 2 s, and every request of every read takes the token
    /// of one bucket (<see cref="AirTrafficRequestBucket"/>), at most 0.8 a second.
    /// </summary>
    public bool AirfieldReadsEnabled { get; init; } = true;

    /// <summary>The radius of the airfield read, in nautical miles (1 to <see cref="MaxAirfieldRadiusNm"/>).</summary>
    public int AirfieldRadiusNm { get; init; } = DefaultAirfieldRadiusNm;

    /// <summary>
    /// The time between two airfield reads, counted from when each request goes out; never below
    /// <see cref="MinimumAirfieldInterval"/>.
    /// </summary>
    public TimeSpan AirfieldInterval { get; init; } = DefaultAirfieldInterval;

    /// <summary>
    /// M3: whether, while the airfield reads run, the AVIAM flights that should be in the air and were not in the last read
    /// of the whole circle are looked up by their callsign (adsb.fi's <c>/api/v2/callsign</c>), in turn, at most one every
    /// <see cref="CallsignLookupInterval"/>. On by default; it runs only where the airfield reads run.
    /// </summary>
    public bool CallsignLookupsEnabled { get; init; } = true;

    /// <summary>M3: the shortest time between two callsign lookups, counted from when each request goes out.</summary>
    public static TimeSpan CallsignLookupInterval => TimeSpan.FromSeconds(4);

    /// <summary>
    /// M3: how long an aircraft a lookup found stays in the picture after the last lookup that saw it. It is kept in memory
    /// only (adsb.fi's licence: nothing is persisted).
    /// </summary>
    public static TimeSpan CallsignLookupRetention => TimeSpan.FromMinutes(15);

    /// <summary>The small circle the airfield read asks for: the same centre, <see cref="AirfieldRadiusNm"/>.</summary>
    public AirTrafficArea AirfieldArea => new(CenterLatitude, CenterLongitude, AirfieldRadiusNm);
}
