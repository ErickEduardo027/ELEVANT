using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The only tests that read aviationweather.gov (ADR-0043): one METAR and one TAF query of Punta Cana (MDPC), and since
/// plan M6 one of each for the airports of its region. They run only with ELEVANT_LIVE_AVIATION_WEATHER=1; CI never calls a
/// network. They report counts only, never the answer.
/// </summary>
public sealed class AviationWeatherLiveTests
{
    [Fact]
    public async Task LiveMetarAndTafOfPuntaCanaParse()
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_LIVE_AVIATION_WEATHER") != "1") return;
        using var source = new AviationWeatherSource(AviationWeatherSource.CreateHttpClient(),
            new Uri(new AviationWeatherOptions().BaseUrl), TimeProvider.System);

        var weather = await source.ReadAsync("MDPC", TestContext.Current.CancellationToken);

        Assert.NotNull(weather);
        var retrievedAt = weather.RetrievedAt;
        Assert.True(retrievedAt is not null, "aviationweather.gov answered neither the METAR nor the TAF query.");
        var metar = weather.Metar;
        Assert.True(metar is not null, "aviationweather.gov answered no METAR of MDPC that could be read.");
        Assert.True(metar.ObservedAt <= retrievedAt.Value.AddMinutes(5));
        var taf = weather.Taf;
        TestContext.Current.SendDiagnosticMessage(
            $"MDPC: a METAR observed {(int)(retrievedAt.Value - metar.ObservedAt).TotalMinutes} min before the read, with " +
            $"{metar.Clouds.Count} cloud layers; " + (taf is null ? "no TAF." : $"a TAF with {taf.Periods.Count} periods."));
    }

    /// <summary>
    /// Plan M6: one METAR and one TAF query for the 32 airports of Punta Cana's region. Counts only: how many airports
    /// have a METAR, how many of those carry the service's flight category, and how many have a TAF.
    /// </summary>
    [Fact]
    public async Task LiveMetarsAndTafsOfPuntaCanasRegionParse()
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_LIVE_AVIATION_WEATHER") != "1") return;
        using var source = new AviationWeatherRegionSource(AviationWeatherSource.CreateHttpClient(),
            new Uri(new AviationWeatherOptions().BaseUrl), TimeProvider.System);
        var codes = Elevant.Application.Operations.Weather.RegionWeatherStations.AroundPuntaCana
            .Select(station => station.IcaoCode).ToArray();

        var weather = await source.ReadAsync(codes, TestContext.Current.CancellationToken);

        Assert.NotNull(weather);
        Assert.True(weather.MetarFailure is null, $"The METAR query of the region failed: {weather.MetarFailure}.");
        Assert.True(weather.Metars.ContainsKey("MDPC"), "aviationweather.gov answered no METAR of MDPC that could be read.");
        Assert.All(weather.Metars.Keys, code => Assert.Contains(code, codes));
        TestContext.Current.SendDiagnosticMessage(
            $"Region: {weather.Metars.Count} of {codes.Length} airports with a METAR, " +
            $"{weather.Metars.Values.Count(metar => metar.FlightCategory is not null)} with a flight category, " +
            $"{weather.Tafs.Count} with a TAF.");
    }
}
