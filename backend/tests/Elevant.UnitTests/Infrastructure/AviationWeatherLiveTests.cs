using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The only test that reads aviationweather.gov (ADR-0043): one METAR and one TAF query of Punta Cana (MDPC). It runs only
/// with ELEVANT_LIVE_AVIATION_WEATHER=1; CI never calls a network. It reports counts only, never the answer.
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
}
