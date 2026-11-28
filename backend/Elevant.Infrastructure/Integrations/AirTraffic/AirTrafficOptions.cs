using Elevant.Application.Operations.AirPicture;

namespace Elevant.Infrastructure.Integrations.AirTraffic;

/// <summary>
/// The <c>AirTraffic</c> section (ADR-0042, contracts 1.3): the live aircraft of the OCC map. Off by default; with
/// <see cref="Enabled"/> off or <see cref="Providers"/> empty nothing is ever called. Every value is checked when the API
/// starts, also while it is off, and a value out of range stops the start.
/// </summary>
public sealed class AirTrafficOptions
{
    public const string SectionName = "AirTraffic";

    public bool Enabled { get; set; }

    /// <summary>
    /// The networks to read, in order: <c>AdsbFi</c>, <c>AdsbLol</c>. The first one answers and the next takes over after
    /// three failures in a row. Empty by default, because the configuration binder adds to a list that already has items.
    /// </summary>
    public List<string> Providers { get; set; } = [];

    /// <summary>The only station with an air picture.</summary>
    public string StationCode { get; set; } = AirTrafficSettings.DefaultStationCode;

    public double CenterLatitude { get; set; } = AirTrafficSettings.DefaultCenterLatitude;

    public double CenterLongitude { get; set; } = AirTrafficSettings.DefaultCenterLongitude;

    /// <summary>The radius of every read in nautical miles, from 1 to 250.</summary>
    public int RadiusNm { get; set; } = AirTrafficSettings.MaxRadiusNm;

    /// <summary>Seconds between two reads; never below 10.</summary>
    public int IntervalSeconds { get; set; } = (int)AirTrafficSettings.MinimumInterval.TotalSeconds;

    /// <summary>Seconds one request of the map keeps the reads going; at least <see cref="IntervalSeconds"/>.</summary>
    public int IdleAfterSeconds { get; set; } = (int)AirTrafficSettings.DefaultIdleAfter.TotalSeconds;

    /// <summary>
    /// CN-31: whether the airfield is also read every few seconds while the map is watched (adsb.fi only). Every request
    /// of every read shares one bucket of at most 0.8 a second (M3, <see cref="AirTrafficRequestBucket"/>).
    /// </summary>
    public bool AirfieldReadsEnabled { get; set; } = true;

    /// <summary>
    /// The radius of the airfield read in nautical miles, from 1 to 25; 5 by default, 25 (the approach) in Development.
    /// </summary>
    public int AirfieldRadiusNm { get; set; } = AirTrafficSettings.DefaultAirfieldRadiusNm;

    /// <summary>
    /// Seconds between two airfield reads, from when each request goes out; never below 2. 3 by default, 2 in Development.
    /// </summary>
    public int AirfieldIntervalSeconds { get; set; } = (int)AirTrafficSettings.DefaultAirfieldInterval.TotalSeconds;

    /// <summary>
    /// M3: whether the AVIAM flights that should be in the air and are not in the whole circle are looked up by their
    /// callsign while the map is watched, at most one lookup every 4 s (adsb.fi only, with the airfield reads on).
    /// </summary>
    public bool CallsignLookupsEnabled { get; set; } = true;

    /// <summary>Minutes an aircraft's trail is kept, from 1 to 180.</summary>
    public int TrailMinutes { get; set; } = AirTrafficSettings.MaxTrailMinutes;

    /// <summary>
    /// Optional adsb.lol key, from secret configuration only (<c>AirTraffic__ApiKey</c>). It is sent only to adsb.lol
    /// and never logged.
    /// </summary>
    public string? ApiKey { get; set; }
}
