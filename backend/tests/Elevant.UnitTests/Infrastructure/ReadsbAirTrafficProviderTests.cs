using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Integrations.AirTraffic;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0042: the readsb v2 adapter of adsb.fi and adsb.lol, against synthetic answers (never a network). The fixtures keep
/// the shape of readsb's v2 JSON (the aircraft under <c>ac</c> with <c>now</c> in milliseconds, as adsb.lol's OpenAPI
/// documents it, or under <c>aircraft</c> with <c>now</c> in seconds, as readsb's aircraft.json writes it); every address,
/// registration, flight and position in them is invented.
/// </summary>
public sealed class ReadsbAirTrafficProviderTests
{
    private static readonly AirTrafficArea PuntaCana = new(18.5674, -68.3634, 250);
    private static readonly DateTimeOffset Start = new(2026, 11, 13, 15, 0, 1, TimeSpan.Zero);
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task ParsesTheAdsbFiProfile()
    {
        var handler = new StubHandler(_ => Json(Fixture("readsb-adsbfi-point.synthetic.json")));
        using var provider = Provider(handler, ReadsbProfile.AdsbFi);

        var result = await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);

        Assert.Equal((AirTrafficOutcome.Succeeded, ReadsbProfile.AdsbFi.Attribution, (TimeSpan?)null),
            (result.Outcome, result.Source, result.RetryAfter));
        // «now» in seconds, with its fraction.
        Assert.Equal(Now.AddMilliseconds(500), result.ObservedAt);
        // Skipped: the ~ address, the aircraft without a position, the position 150 s old and the five-digit address.
        Assert.Equal(["f0a001", "f0a002", "f0a006"], result.Aircraft.Select(aircraft => aircraft.Hex));
        Assert.Equal(new AirTrafficAircraft("f0a001", "ZZA901", "ZZ-SYA", "B738", "A3", 18.512345, -68.501234, 3500, false,
            182.4, 82.5, -768, "4521", Now.AddMilliseconds(100)), result.Aircraft[0]);
        Assert.Equal(new AirTrafficAircraft("f0a002", "ZZA902", "ZZ-SYB", "A320", "A3", 18.567123, -68.362901, null, true,
            12.3, 264.0, null, "2000", Now.AddMilliseconds(-600)), result.Aircraft[1]);
        // A blank flight is no callsign; the geometric altitude and rate stand in for the barometric ones; «seen» dates a
        // position without «seen_pos»; the address is written in lower case.
        Assert.Equal(new AirTrafficAircraft("f0a006", null, null, null, null, 18.9, -67.95, 12025, false, 401.7, 359.9, 1024,
            null, Now.AddMilliseconds(-2500)), result.Aircraft[2]);
    }

    [Fact]
    public async Task ParsesTheAdsbLolProfile()
    {
        var handler = new StubHandler(_ => Json(Fixture("readsb-adsblol-point.synthetic.json")));
        using var provider = Provider(handler, ReadsbProfile.AdsbLol);

        var result = await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);

        Assert.Equal((AirTrafficOutcome.Succeeded, ReadsbProfile.AdsbLol.Attribution, (TimeSpan?)null),
            (result.Outcome, result.Source, result.RetryAfter));
        // «now» in milliseconds.
        Assert.Equal(Now.AddMilliseconds(250), result.ObservedAt);
        // Skipped: the ~ address and the position 121 s old.
        Assert.Equal(2, result.Aircraft.Count);
        Assert.Equal(new AirTrafficAircraft("f0b001", "ZZA911", "ZZ-SYC", "E190", "A3", 18.731, -68.912, 11975, false,
            288.6, 101.3, -1344, "6017", Now.AddMilliseconds(-550)), result.Aircraft[0]);
        Assert.Equal(new AirTrafficAircraft("f0b002", "ZZA912", "ZZ-SYD", "B77W", "A5", 18.566812, -68.358745, null, true,
            0, 172.6, null, "1200", Now.AddMilliseconds(-5250)), result.Aircraft[1]);
    }

    [Fact]
    public void GroundAltitudeMeansOnGround()
    {
        var (_, aircraft) = Parse("""
            {"now": 1794582000, "aircraft": [
              {"hex": "f0c001", "alt_baro": "ground", "alt_geom": 75, "gs": 8.1, "true_heading": 91.5,
               "lat": 18.5671, "lon": -68.3629, "seen_pos": 1},
              {"hex": "f0c002", "alt_baro": " Ground ", "track": 12.0, "true_heading": 15.0,
               "lat": 18.5672, "lon": -68.3631, "seen_pos": 1},
              {"hex": "f0c003", "alt_baro": 0, "true_heading": 45.0, "lat": 18.5673, "lon": -68.3632, "seen_pos": 1}
            ]}
            """);

        // On the ground there is no altitude, not even the geometric one, and the heading stands in for a missing track.
        Assert.Equal((true, (int?)null, (double?)91.5), (aircraft[0].OnGround, aircraft[0].AltitudeFeet, aircraft[0].TrackDegrees));
        Assert.Equal((true, (int?)null, (double?)12.0), (aircraft[1].OnGround, aircraft[1].AltitudeFeet, aircraft[1].TrackDegrees));
        // Zero feet is an altitude, and an airborne aircraft without a track has none.
        Assert.Equal((false, (int?)0, (double?)null), (aircraft[2].OnGround, aircraft[2].AltitudeFeet, aircraft[2].TrackDegrees));
    }

    [Fact]
    public void SkipsAircraftWithoutPositionOrWithANonIcaoAddress()
    {
        var (_, aircraft) = Parse("""
            {"now": 1794582000, "ac": [
              {"hex": "f0d001", "lat": 18.5, "lon": -68.5, "seen_pos": 1},
              {"hex": "f0d002", "alt_baro": 30000, "seen": 1},
              {"hex": "f0d003", "lat": 18.5, "seen_pos": 1},
              {"hex": "f0d004", "lat": "18.5", "lon": "-68.5", "seen_pos": 1},
              {"hex": "f0d005", "lat": 90.5, "lon": -68.5, "seen_pos": 1},
              {"hex": "f0d006", "lat": 18.5, "lon": -180.5, "seen_pos": 1},
              {"hex": "~f0d007", "lat": 18.5, "lon": -68.5, "seen_pos": 1},
              {"hex": "f0d08", "lat": 18.5, "lon": -68.5, "seen_pos": 1},
              {"hex": "f0d00g", "lat": 18.5, "lon": -68.5, "seen_pos": 1},
              {"hex": 15781889, "lat": 18.5, "lon": -68.5, "seen_pos": 1},
              {"lat": 18.5, "lon": -68.5, "seen_pos": 1},
              "f0d012"
            ]}
            """);

        Assert.Equal("f0d001", Assert.Single(aircraft).Hex);
    }

    [Fact]
    public void SkipsPositionsOlderThanTwoMinutes()
    {
        var (observedAt, aircraft) = Parse("""
            {"now": 1794582000000, "ac": [
              {"hex": "f0e001", "lat": 18.5, "lon": -68.5, "seen_pos": 120.0},
              {"hex": "f0e002", "lat": 18.5, "lon": -68.5, "seen_pos": 120.1},
              {"hex": "f0e003", "lat": 18.5, "lon": -68.5, "seen": 119.5},
              {"hex": "f0e004", "lat": 18.5, "lon": -68.5, "seen": 121},
              {"hex": "f0e005", "lat": 18.5, "lon": -68.5, "seen_pos": 1.0, "seen": 200},
              {"hex": "f0e006", "lat": 18.5, "lon": -68.5}
            ]}
            """);

        Assert.Equal(Now, observedAt);
        Assert.Equal(
            [("f0e001", Now.AddSeconds(-120)), ("f0e003", Now.AddSeconds(-119.5)), ("f0e005", Now.AddSeconds(-1)), ("f0e006", Now)],
            aircraft.Select(item => (item.Hex, item.PositionAt)));
    }

    [Fact]
    public void KeepsTheFreshestOfDuplicateHexCodes()
    {
        var (_, aircraft) = Parse("""
            {"now": 1794582000, "aircraft": [
              {"hex": "f0f001", "flight": "ZZA931", "lat": 18.40, "lon": -68.60, "seen_pos": 30},
              {"hex": "F0F001", "flight": "ZZA931", "lat": 18.45, "lon": -68.55, "seen_pos": 2},
              {"hex": "f0f001", "flight": "ZZA931", "lat": 18.30, "lon": -68.70, "seen_pos": 60}
            ]}
            """);

        var freshest = Assert.Single(aircraft);
        Assert.Equal(("f0f001", 18.45, -68.55, Now.AddSeconds(-2)),
            (freshest.Hex, freshest.Latitude, freshest.Longitude, freshest.PositionAt));
    }

    [Fact]
    public void AnAnswerWithoutNowIsDatedWhenItArrivedAndOneWithoutAListIsNone()
    {
        // Start is when the answer arrived.
        Assert.Equal(Start, Parse("""{"ac": []}""").ObservedAt);
        Assert.Equal(Start, Parse("""{"now": "soon", "aircraft": []}""").ObservedAt);
        Assert.Empty(Parse("""{"ac": []}""").Aircraft);

        Assert.Null(TryParse("""{"msg": "No error", "now": 1794582000}"""));
        Assert.Null(TryParse("""{"ac": {}}"""));
        Assert.Null(TryParse("[]"));
    }

    [Fact]
    public async Task BuildsThePointQueryOfEachProfileInAnyCulture()
    {
        var culture = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("es-ES");
        try
        {
            foreach (var (profile, query) in new[]
                     {
                         (ReadsbProfile.AdsbFi, "https://opendata.adsb.fi/api/v3/lat/18.5674/lon/-68.3634/dist/250"),
                         (ReadsbProfile.AdsbLol, "https://api.adsb.lol/v2/point/18.5674/-68.3634/250"),
                     })
            {
                var handler = new StubHandler(_ => Json("""{"ac": []}"""));
                using var provider = Provider(handler, profile);
                await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);
                var request = Assert.Single(handler.Requests);
                Assert.Equal((HttpMethod.Get, query), (request.Method, request.Uri));
            }

            // Four decimals with a dot, and never a negative zero.
            Assert.Equal("https://opendata.adsb.fi/api/v3/lat/-33.9461/lon/151.1772/dist/40",
                ReadsbProfile.AdsbFi.PointQuery(new AirTrafficArea(-33.94612, 151.17722, 40)).AbsoluteUri);
            Assert.Equal("https://api.adsb.lol/v2/point/0.0000/-0.0001/1",
                ReadsbProfile.AdsbLol.PointQuery(new AirTrafficArea(-0.00004, -0.00006, 1)).AbsoluteUri);
        }
        finally
        {
            CultureInfo.CurrentCulture = culture;
        }
    }

    [Fact]
    public async Task AnAreaOffTheEarthOrWiderThanTheNetworksAnswerIsRefused()
    {
        var handler = new StubHandler(_ => Json("""{"ac": []}"""));
        using var provider = Provider(handler, ReadsbProfile.AdsbFi);
        foreach (var area in new AirTrafficArea[] { new(90.1, 0, 10), new(0, -180.1, 10), new(double.NaN, 0, 10), new(0, 0, 0), new(0, 0, 251) })
            await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => provider.ReadAsync(area, TestContext.Current.CancellationToken));
        Assert.Empty(handler.Requests);
    }

    [Theory]
    [InlineData("AdsbLol", "synthetic-lol-key", "synthetic-lol-key")]
    [InlineData("AdsbLol", "  synthetic-lol-key  ", "synthetic-lol-key")]
    [InlineData("AdsbLol", null, null)]
    [InlineData("AdsbLol", " ", null)]
    [InlineData("AdsbFi", "synthetic-lol-key", null)]
    public async Task SendsTheApiKeyOnlyWhenConfigured(string profileName, string? key, string? sent)
    {
        var handler = new StubHandler(_ => Json("""{"ac": []}"""));
        using var provider = Provider(handler, ReadsbProfile.Find(profileName)!, key);

        await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);

        // adsb.fi takes no key: one meant for adsb.lol never reaches it.
        Assert.Equal(sent, Assert.Single(handler.Requests).Key);
        Assert.Equal(sent is not null, provider.SendsKey);
    }

    [Fact]
    public async Task SendsAGenericUserAgentAndAsksForJson()
    {
        var handler = new StubHandler(_ => Json("""{"ac": []}"""));
        using var provider = Provider(handler, ReadsbProfile.AdsbFi);

        await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);

        var request = Assert.Single(handler.Requests);
        Assert.Equal((ReadsbAirTrafficProvider.UserAgent, "application/json"), (request.UserAgent, request.Accept));
        foreach (var revealing in new[] { "ELEVANT", "AVIAM", "@", "http" })
            Assert.DoesNotContain(revealing, request.UserAgent, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void TheClientFollowsNoRedirectAcceptsCompressedAnswersAndGivesUpAfterTenSeconds()
    {
        using var handler = ReadsbAirTrafficProvider.CreateHandler();
        Assert.False(handler.AllowAutoRedirect);
        Assert.Equal(DecompressionMethods.All, handler.AutomaticDecompression);

        using var client = ReadsbAirTrafficProvider.CreateHttpClient();
        Assert.Equal(TimeSpan.FromSeconds(10), client.Timeout);
        Assert.Equal(ReadsbAirTrafficProvider.MaxAnswerBytes, client.MaxResponseContentBufferSize);
    }

    [Fact]
    public async Task TooManyRequestsCarriesRetryAfter()
    {
        var clock = new ManualClock(Start);
        var retryAfter = new Queue<RetryConditionHeaderValue?>(
        [
            new RetryConditionHeaderValue(TimeSpan.FromSeconds(30)),
            new RetryConditionHeaderValue(Start.AddMinutes(2)),
            new RetryConditionHeaderValue(Start.AddMinutes(-1)),
            null,
        ]);
        var handler = new StubHandler(_ =>
        {
            var limited = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            limited.Headers.RetryAfter = retryAfter.Dequeue();
            return limited;
        });
        using var provider = Provider(handler, ReadsbProfile.AdsbFi, clock: clock);

        var delays = new List<TimeSpan?>();
        for (var read = 0; read < 4; read++)
        {
            var result = await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);
            Assert.Equal((AirTrafficOutcome.RateLimited, ReadsbProfile.AdsbFi.Attribution), (result.Outcome, result.Source));
            Assert.Empty(result.Aircraft);
            delays.Add(result.RetryAfter);
        }

        // As a delay, as a date (a past date waits nothing) or not said at all.
        Assert.Equal([TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(2), TimeSpan.Zero, null], delays);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task ARejectedOrForbiddenKeyIsUnauthorized(HttpStatusCode status)
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(status) { Content = new StringContent("Forbidden") });
        using var provider = Provider(handler, ReadsbProfile.AdsbLol, "synthetic-lol-key");

        var result = await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);

        Assert.Equal((AirTrafficOutcome.Unauthorized, ReadsbProfile.AdsbLol.Attribution, (DateTimeOffset?)null, (TimeSpan?)null),
            (result.Outcome, result.Source, result.ObservedAt, result.RetryAfter));
        Assert.Empty(result.Aircraft);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("""{"msg": "No error", "now": 1794582000}""")]
    [InlineData("""{"ac": {"hex": "f0a001"}}""")]
    [InlineData("[]")]
    [InlineData("timeout")]
    [InlineData("connection refused")]
    [InlineData("server error")]
    [InlineData("unavailable")]
    [InlineData("not found")]
    [InlineData("redirect")]
    public async Task BadJsonATimeoutOrAServerErrorIsAFailure(string answer)
    {
        var handler = new StubHandler(_ => answer switch
        {
            // What HttpClient throws when its own limit runs out.
            "timeout" => throw new TaskCanceledException("The request was canceled.", new TimeoutException()),
            "connection refused" => throw new HttpRequestException("Connection refused."),
            "server error" => new HttpResponseMessage(HttpStatusCode.InternalServerError),
            "unavailable" => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable),
            "not found" => new HttpResponseMessage(HttpStatusCode.NotFound),
            // A redirect is never followed.
            "redirect" => new HttpResponseMessage(HttpStatusCode.Found)
                { Headers = { Location = new Uri("https://mirror.example/v2/point/18.5674/-68.3634/250") } },
            _ => Json(answer),
        });
        using var provider = Provider(handler, ReadsbProfile.AdsbFi);

        var result = await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);

        Assert.Equal((AirTrafficOutcome.Failed, ReadsbProfile.AdsbFi.Attribution, (DateTimeOffset?)null),
            (result.Outcome, result.Source, result.ObservedAt));
        Assert.Empty(result.Aircraft);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task TheCallersCancellationIsThrown()
    {
        var handler = new StubHandler(_ => Json("""{"ac": []}"""));
        using var provider = Provider(handler, ReadsbProfile.AdsbFi);
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => provider.ReadAsync(PuntaCana, cancellation.Token));
    }

    [Fact]
    public async Task TheAdsbLolDailyCounterStopsBeforeTheLimit()
    {
        // One hour before the UTC day ends.
        var clock = new ManualClock(new DateTimeOffset(2026, 11, 13, 23, 0, 0, TimeSpan.Zero));
        // Every request sent counts, also one the network fails: every tenth answer here is a 503.
        var sent = 0;
        var handler = new StubHandler(_ => ++sent % 10 == 0
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : Json("""{"ac": []}"""));
        using var provider = Provider(handler, ReadsbProfile.AdsbLol, clock: clock);
        Assert.Equal(450, provider.DailyLimit);

        for (var read = 0; read < 450; read++)
            Assert.NotEqual(AirTrafficOutcome.QuotaExceeded,
                (await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken)).Outcome);
        var refused = await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken);

        // The 451st read of the day is refused without calling, 50 short of adsb.lol's own limit, until the next UTC day.
        // It asks for no wait, so the next network of the list can take over.
        Assert.Equal((AirTrafficOutcome.QuotaExceeded, ReadsbProfile.AdsbLol.Attribution, (TimeSpan?)null),
            (refused.Outcome, refused.Source, refused.RetryAfter));
        Assert.Equal(AirTrafficOutcome.QuotaExceeded,
            (await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken)).Outcome);
        Assert.Equal(450, handler.Requests.Count);
        clock.Advance(TimeSpan.FromHours(1));
        Assert.Equal(AirTrafficOutcome.Succeeded, (await provider.ReadAsync(PuntaCana, TestContext.Current.CancellationToken)).Outcome);
        Assert.Equal(451, handler.Requests.Count);

        // A key allows 900 a day (adsb.lol gives 1 000); adsb.fi has no daily counter.
        using var keyed = Provider(new StubHandler(_ => Json("""{"ac": []}""")), ReadsbProfile.AdsbLol, "synthetic-lol-key");
        Assert.Equal(900, keyed.DailyLimit);
        using var adsbFi = Provider(new StubHandler(_ => Json("""{"ac": []}""")), ReadsbProfile.AdsbFi, "synthetic-lol-key");
        Assert.Null(adsbFi.DailyLimit);
    }

    private static (DateTimeOffset ObservedAt, IReadOnlyList<AirTrafficAircraft> Aircraft) Parse(string json) =>
        TryParse(json) ?? throw new InvalidOperationException("The answer has no aircraft list.");

    private static (DateTimeOffset ObservedAt, IReadOnlyList<AirTrafficAircraft> Aircraft)? TryParse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return ReadsbV2Parser.Parse(document.RootElement, Start);
    }

    private static ReadsbAirTrafficProvider Provider(StubHandler handler, ReadsbProfile profile, string? key = null,
        TimeProvider? clock = null) =>
        new(new HttpClient(handler), profile, key, clock ?? new ManualClock(Start));

    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Infrastructure", "Fixtures", name));

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed record SentRequest(HttpMethod Method, string Uri, string UserAgent, string Accept, string? Key);

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<SentRequest> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Requests.Add(new SentRequest(request.Method, request.RequestUri!.AbsoluteUri, request.Headers.UserAgent.ToString(),
                request.Headers.Accept.ToString(),
                request.Headers.TryGetValues("x-api-key", out var values) ? values.Single() : null));
            return Task.FromResult(respond(request));
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan amount) => _now += amount;
    }
}
