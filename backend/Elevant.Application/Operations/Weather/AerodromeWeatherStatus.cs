using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.Weather;

/// <summary>
/// The state of an airport's weather as the OCC reads it (ADR-0043, contracts 1.4). It always travels in the read's 200,
/// like the state of the air picture: a weather service that fails is a state of the weather, never a server error.
/// </summary>
public static class AerodromeWeatherStatus
{
    /// <summary>A METAR at most <see cref="LiveMetarAge"/> older than the server's time, from a read that did not fail.</summary>
    public const string Live = "Live";

    /// <summary>A METAR older than <see cref="LiveMetarAge"/>, or the one kept from an earlier read after the service failed.</summary>
    public const string Stale = "Stale";

    /// <summary>A weather service is configured but there is no METAR to show; the TAF may still come.</summary>
    public const string Unavailable = "Unavailable";

    /// <summary>No weather service is configured here: nothing is ever called, and there is no report.</summary>
    public const string Disabled = "Disabled";

    /// <summary>The oldest a METAR may be, against the server's time, and still be live.</summary>
    public static TimeSpan LiveMetarAge { get; } = TimeSpan.FromMinutes(90);

    /// <summary>
    /// The state of <paramref name="data"/> at <paramref name="now"/>; pure. No data (no weather service) is
    /// <see cref="Disabled"/>; data without a METAR <see cref="Unavailable"/>; a METAR kept after a failure, or more than
    /// <see cref="LiveMetarAge"/> older than <paramref name="now"/>, <see cref="Stale"/>; any other METAR <see cref="Live"/>.
    /// </summary>
    public static string Of(AerodromeWeatherData? data, DateTimeOffset now)
    {
        if (data is null) return Disabled;
        if (data.Metar is not { } metar) return Unavailable;
        return data.MetarKeptAfterFailure || now - metar.ObservedAt > LiveMetarAge ? Stale : Live;
    }
}
