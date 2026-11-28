using System.Collections.ObjectModel;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// The weather of the airports of a region for the OCC (plan M6 of 27 November 2026): the latest METAR and the latest TAF
/// of each one, as a weather service publishes them, read for all the airports at once (one request per kind of report).
/// The service is asked only when someone reads the region's weather, and what it answered is kept in memory; nothing is
/// persisted.
/// </summary>
public interface IRegionWeatherSource
{
    /// <summary>
    /// The weather of the airports whose ICAO codes are <paramref name="icaoCodes"/>; null when no weather service is
    /// configured, and then nothing is called. A code that is not four letters is never sent and has no report. A refusal,
    /// a timeout or an answer that cannot be read leaves the reports the source may still serve, never an exception; only
    /// the caller's own cancellation is thrown.
    /// </summary>
    Task<RegionWeatherData?> ReadAsync(IReadOnlyList<string> icaoCodes, CancellationToken cancellationToken = default);
}

/// <summary>
/// The weather of a region's airports, by ICAO code in upper case: an airport the service has no report for, or none the
/// source may still serve, is not in <paramref name="Metars"/> or in <paramref name="Tafs"/>. <paramref name="MetarsKeptAfterFailure"/>
/// is true when the METARs are the ones kept from an earlier read because the last one failed or the service is being
/// waited out. <paramref name="MetarFailure"/> says how the last METAR read failed (null after one that succeeded), and
/// <paramref name="MetarRetryAt"/> is when the source asks for the METARs again while it waits out that failure (null
/// otherwise). The TAFs travel on their own: a TAF read that fails changes neither.
/// </summary>
public sealed record RegionWeatherData(IReadOnlyDictionary<string, AerodromeMetar> Metars, bool MetarsKeptAfterFailure,
    IReadOnlyDictionary<string, AerodromeTaf> Tafs, WeatherServiceFailure? MetarFailure, DateTimeOffset? MetarRetryAt)
{
    /// <summary>No report of any airport, after a read that failed as <paramref name="failure"/> says (null: none failed).</summary>
    public static RegionWeatherData Without(WeatherServiceFailure? failure) =>
        new(ReadOnlyDictionary<string, AerodromeMetar>.Empty, false, ReadOnlyDictionary<string, AerodromeTaf>.Empty, failure,
            null);
}

/// <summary>How the last read of a weather service failed.</summary>
public enum WeatherServiceFailure
{
    /// <summary>The service asked to slow down (HTTP 429).</summary>
    RateLimited,

    /// <summary>A timeout, a network error, another status or an answer that cannot be read.</summary>
    Failed,
}

/// <summary>
/// The source without a weather service, the default of every host (tools, tests, an API with
/// <c>AviationWeather:Enabled</c> off): every read answers null and nothing is ever called.
/// </summary>
public sealed class DisabledRegionWeatherSource : IRegionWeatherSource
{
    public Task<RegionWeatherData?> ReadAsync(IReadOnlyList<string> icaoCodes, CancellationToken cancellationToken = default) =>
        Task.FromResult<RegionWeatherData?>(null);
}
