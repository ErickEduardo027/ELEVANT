using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Infrastructure.Integrations.AirlineRegistry;

namespace Elevant.UnitTests.Application;

public sealed class AirlineRegistryTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 2, 16, 0, 0, TimeSpan.Zero);

    private static AirlineRegistryCandidate Copa(bool active = true) =>
        new("Copa Airlines", ["CM"], ["CMP"], "PA", active, "https://www.wikidata.org/wiki/Q849404");

    [Theory]
    [InlineData("Copa Airlines", "CM", "CMP")]
    [InlineData("COPA", "CM", null)]
    [InlineData("Compañía Panameña de Aviación Copa S.A.", null, "CMP")]
    public void NameAndCodesOfAnActiveAirlineAreFound(string name, string? iata, string? icao)
    {
        var check = AirlineRegistryMatcher.Evaluate(name, iata, icao, [Copa()], "Wikidata", Now);

        Assert.Equal("Found", check.Status);
        Assert.Equal("Copa Airlines", check.MatchedName);
        Assert.Equal("https://www.wikidata.org/wiki/Q849404", check.EntityUrl);
        Assert.Empty(check.Differences);
    }

    [Fact]
    public void SameCodesWithAnotherNameAreAMismatch()
    {
        var check = AirlineRegistryMatcher.Evaluate("Air Century", "CM", "CMP", [Copa()], "Wikidata", Now);

        Assert.Equal("Mismatch", check.Status);
        Assert.Contains("«Copa Airlines»", Assert.Single(check.Differences));
    }

    [Fact]
    public void CodesOfDifferentAirlinesExplainEachOne()
    {
        var other = new AirlineRegistryCandidate("Avianca", ["AV"], ["AVA"], "CO", true, null);
        var check = AirlineRegistryMatcher.Evaluate("Copa Airlines", "CM", "AVA", [Copa(), other], "Wikidata", Now);

        Assert.Equal("Mismatch", check.Status);
        Assert.Equal(2, check.Differences.Count);
        Assert.Contains(check.Differences, item => item.Contains("ICAO AVA corresponde a «Avianca»", StringComparison.Ordinal));
    }

    [Fact]
    public void ADissolvedAirlineIsDefunctAndUnknownCodesAreNotFound()
    {
        Assert.Equal("Defunct", AirlineRegistryMatcher.Evaluate("Copa", "CM", "CMP", [Copa(active: false)], "OpenFlights", Now).Status);
        var missing = AirlineRegistryMatcher.Evaluate("Nueva", "Q9", "QQQ", [], "Wikidata", Now);
        Assert.Equal("NotFound", missing.Status);
        Assert.Contains("IATA Q9 ni el ICAO QQQ", Assert.Single(missing.Differences));
        Assert.Equal("NotFound", AirlineRegistryMatcher.Evaluate("Sin códigos", null, null, [Copa()], "Wikidata", Now).Status);
    }

    [Theory]
    [InlineData("Delta Air Lines", "Delta", true)]
    [InlineData("Aerolíneas Argentinas", "Aerolineas Argentinas S.A.", true)]
    [InlineData("Air Canada", "Air Century", false)]
    [InlineData("JetBlue", "Jet Blue Airways", false)]
    public void NamesAreComparedWithoutAccentsOrGenericWords(string left, string right, bool same) =>
        Assert.Equal(same, AirlineRegistryMatcher.SameName(left, right));

    [Fact]
    public void WikidataRowsAreGroupedByEntityWithTheirCodesAndDissolution()
    {
        using var json = JsonDocument.Parse("""
            {"results":{"bindings":[
              {"item":{"value":"http://www.wikidata.org/entity/Q849404"},"itemLabel":{"value":"Copa Airlines"},
               "iata":{"value":"CM"},"icao":{"value":"CMP"},"countryCode":{"value":"PA"}},
              {"item":{"value":"http://www.wikidata.org/entity/Q849404"},"itemLabel":{"value":"Copa Airlines"},
               "iata":{"value":"CM"},"icao":{"value":"CMP"}},
              {"item":{"value":"http://www.wikidata.org/entity/Q100"},"itemLabel":{"value":"Old Carrier"},
               "iata":{"value":"CM"},"dissolved":{"value":"1990-01-01T00:00:00Z"}},
              {"item":{"value":"https://evil.example/Q1"},"itemLabel":{"value":"Ignored"}}
            ]}}
            """);

        var candidates = WikidataAirlineRegistrySource.Parse(json.RootElement);

        Assert.Equal(2, candidates.Count);
        var copa = Assert.Single(candidates, item => item.Name == "Copa Airlines");
        Assert.Equal(["CM"], copa.IataCodes);
        Assert.Equal("PA", copa.Country);
        Assert.True(copa.Active);
        Assert.False(Assert.Single(candidates, item => item.Name == "Old Carrier").Active);
    }

    [Fact]
    public async Task OfflineOpenFlightsCopyAnswersWithoutNetwork()
    {
        var rows = await new OpenFlightsAirlineRegistrySource().FindAsync("CM", "CMP", TestContext.Current.CancellationToken);

        Assert.Contains(rows!, row => row.Name.Contains("Copa", StringComparison.OrdinalIgnoreCase) && row.IcaoCodes.Contains("CMP"));
    }

    [Fact]
    public async Task LookupFallsBackWhenWikidataIsDownAndReportsUnavailableWhenNothingAnswers()
    {
        var down = new FixedSource("Wikidata", null);
        var offline = new FixedSource("OpenFlights", [Copa()]);
        var time = new FixedTime(Now);

        var fallback = await new AirlineRegistryLookup([down, offline], time).CheckAsync("Copa Airlines", "CM", "CMP",
            TestContext.Current.CancellationToken);
        Assert.Equal(("Found", "OpenFlights"), (fallback.Status, fallback.Source));

        var nothing = await new AirlineRegistryLookup([down], time).CheckAsync("Copa Airlines", "CM", "CMP",
            TestContext.Current.CancellationToken);
        Assert.Equal(AirlineRegistryCheck.Unavailable, nothing.Status);

        // Wikidata answering «not found» does not hide a match in the next registry.
        var empty = new FixedSource("Wikidata", []);
        var second = await new AirlineRegistryLookup([empty, offline], time).CheckAsync("Copa Airlines", "CM", null,
            TestContext.Current.CancellationToken);
        Assert.Equal("Found", second.Status);
    }

    /// <summary>Real Wikidata request; runs only with ELEVANT_LIVE_REGISTRY=1 so CI never needs the network.</summary>
    [Theory]
    [InlineData("Copa Airlines", "CM", "CMP", "Found")]
    [InlineData("American Airlines", "AA", "AAL", "Found")]
    [InlineData("Copa Airlines", "AA", "AAL", "Mismatch")]
    public async Task LiveWikidataAnswersForRealAirlines(string name, string iata, string icao, string expected)
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_LIVE_REGISTRY") != "1") return;
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
        var lookup = new AirlineRegistryLookup([new WikidataAirlineRegistrySource(http)], TimeProvider.System);

        var check = await lookup.CheckAsync(name, iata, icao, TestContext.Current.CancellationToken);

        Assert.Equal((expected, "Wikidata"), (check.Status, check.Source));
        Assert.StartsWith("https://www.wikidata.org/wiki/Q", check.EntityUrl);
    }

    private sealed class FixedSource(string name, IReadOnlyList<AirlineRegistryCandidate>? rows) : IAirlineRegistrySource
    {
        public string Name => name;

        public Task<IReadOnlyList<AirlineRegistryCandidate>?> FindAsync(string? iataCode, string? icaoCode,
            CancellationToken cancellationToken = default) => Task.FromResult(rows);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
