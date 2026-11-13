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
}
