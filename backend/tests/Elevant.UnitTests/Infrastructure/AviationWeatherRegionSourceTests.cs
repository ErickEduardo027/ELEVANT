using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.Weather;
using Elevant.Infrastructure.Integrations.AirTraffic;
using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// Plan M6: the aviationweather.gov source of the METAR and the TAF of a region's airports, against synthetic answers
/// (never a network). The fixtures keep the shape the Data API answers for several airports at once
/// (<c>metar?ids=A,B,…&amp;format=json</c> and <c>taf?ids=A,B,…&amp;format=json</c>: one list with the reports of every
/// airport, each with its <c>icaoId</c>); every value in them is invented.
/// </summary>
public sealed class AviationWeatherRegionSourceTests
{
    private const string MetarFixture = "awc-metar-region.synthetic.json";
    private const string TafFixture = "awc-taf-region.synthetic.json";
    private static readonly DateTimeOffset Start = new(2026, 11, 13, 15, 5, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset At1500 = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static readonly Uri DataApi = new("https://aviationweather.gov/api/data/");
    // What a User-Agent must not carry: the project, the company, an address or a link.
    private static readonly string[] Revealing = ["ELEVANT", "AVIAM", "@", "http"];

    /// <summary>Some airports of Punta Cana's region; MDSI has no report in the fixtures.</summary>
    private static readonly string[] Region = ["MDPC", "MDSD", "TJSJ", "MTPP", "MDLR", "MBPV", "MDCY", "MDSI"];

    [Fact]
    public async Task ParsesTheReportsOfEveryAirportOfTheRegion()
    {
        var handler = new StubHandler(request => Json(Fixture(IsMetar(request) ? MetarFixture : TafFixture)));
        using var source = Source(handler);

        var weather = await Read(source, TestContext.Current.CancellationToken);

        // One METAR per airport with a readable one: MDLR's cannot be read, MDCY and MDSI have none, and Miami's was not
        // asked for. Nothing failed.
        Assert.Equal(["MBPV", "MDPC", "MDSD", "MTPP", "TJSJ"], weather.Metars.Keys.Order(StringComparer.Ordinal));
        Assert.Equal((false, (WeatherServiceFailure?)null, (DateTimeOffset?)null),
            (weather.MetarsKeptAfterFailure, weather.MetarFailure, weather.MetarRetryAt));

        // The latest of MDPC's two observations, read as the airport read reads it.
        var mdpc = weather.Metars["MDPC"];
        Assert.Equal(new AerodromeMetar("MDPC 131500Z 09014G24KT 9999 VCSH FEW018 SCT035 BKN080 29/22 Q1015 NOSIG", At1500,
            "VFR", 90, false, 14, 24, 6, 29, 22, 1015, "VCSH", mdpc.Clouds), mdpc);
        Assert.Equal([new AerodromeCloudLayer("FEW", 1800), new AerodromeCloudLayer("SCT", 3500),
            new AerodromeCloudLayer("BKN", 8000)], mdpc.Clouds);

        // A variable wind has no direction; «2» is two miles; 29.92 inches of mercury are hectopascals.
        var mdsd = weather.Metars["MDSD"];
        Assert.Equal(("IFR", (int?)null, true, (int?)3, (int?)null, (double?)2, "-RA BR"),
            (mdsd.FlightCategory, mdsd.WindDirectionDegrees, mdsd.WindVariable, mdsd.WindSpeedKnots, mdsd.WindGustKnots,
                mdsd.VisibilityStatuteMiles, mdsd.Weather));
        Assert.Equal(1013.2, mdsd.AltimeterHectopascals!.Value, 6);
        Assert.Equal([new AerodromeCloudLayer("BKN", 800), new AerodromeCloudLayer("OVC", 1500)], mdsd.Clouds);

        // An airport's code in lower case and an ISO time; «10+» is ten miles and 1016.3 already hectopascals.
        var tjsj = weather.Metars["TJSJ"];
        Assert.Equal(("TJSJ 131456Z 07018G28KT 10SM SCT020 OVC025 27/21 A3001", At1500.AddMinutes(-4), "MVFR", (int?)70,
                (int?)18, (int?)28, (double?)10, (double?)1016.3),
            (tjsj.Raw, tjsj.ObservedAt, tjsj.FlightCategory, tjsj.WindDirectionDegrees, tjsj.WindSpeedKnots,
                tjsj.WindGustKnots, tjsj.VisibilityStatuteMiles, tjsj.AltimeterHectopascals));

        // Fog with the sky obscured, a calm wind and a quarter of a mile; a report without a category keeps none.
        var mtpp = weather.Metars["MTPP"];
        Assert.Equal(("LIFR", (int?)0, (int?)0, (double?)0.25, "FG"),
            (mtpp.FlightCategory, mtpp.WindDirectionDegrees, mtpp.WindSpeedKnots, mtpp.VisibilityStatuteMiles, mtpp.Weather));
        Assert.Equal([new AerodromeCloudLayer("OVX", 200)], mtpp.Clouds);
        Assert.Equal(((string?)null, At1500.AddMinutes(-6)), (weather.Metars["MBPV"].FlightCategory,
            weather.Metars["MBPV"].ObservedAt));

        // One TAF per airport with one: San Juan's latest issue (the amendment) and Samaná's, still valid.
        Assert.Equal(["MDCY", "MDPC", "MDSD", "TJSJ"], weather.Tafs.Keys.Order(StringComparer.Ordinal));
        var tjsjTaf = weather.Tafs["TJSJ"];
        Assert.Equal(("TAF AMD TJSJ 131430Z 1315/1415 07015G25KT P6SM BKN025", At1500.AddMinutes(-30), At1500,
            At1500.AddHours(24)), (tjsjTaf.Raw, tjsjTaf.IssuedAt, tjsjTaf.ValidFrom, tjsjTaf.ValidTo));
        Assert.Equal(2, weather.Tafs["MDPC"].Periods.Count);
        Assert.Equal(new DateTimeOffset(2026, 11, 13, 16, 0, 0, TimeSpan.Zero), weather.Tafs["MDCY"].ValidTo);
    }

    [Fact]
    public void ReadsEachAirportOfOneAnswer()
    {
        // Not a list: unreadable. A list without the region's airports: no report.
        Assert.Equal(AviationWeatherReadKind.Unreadable, Metars("""{"icaoId": "MDPC"}""").Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Metars("null").Kind);
        Assert.Equal((AviationWeatherReadKind.NoReport, (IReadOnlyDictionary<string, AerodromeMetar>?)null), Metars("[]"));
        Assert.Equal(AviationWeatherReadKind.NoReport, Metars("""
            [{"icaoId": "KMIA", "rawOb": "KMIA 131500Z 12008KT 10SM FEW025 28/20 A3002", "obsTime": 1794582000}, "MDPC", 42]
            """).Kind);

        // Reports of the region that none can be read: unreadable, as one airport's would be.
        Assert.Equal((AviationWeatherReadKind.Unreadable, (IReadOnlyDictionary<string, AerodromeMetar>?)null),
            Metars("""[{"icaoId": "MDPC", "obsTime": 1794582000}, {"icaoId": "MDSD", "rawOb": "MDSD 131500Z"}]"""));

        // One that can be read is enough: the airport whose report cannot be read is left out, the others are kept, each
        // with its latest report wherever it is in the list.
        var (kind, reports) = Metars("""
            [
              {"icaoId": "MDPC", "rawOb": "MDPC 131400Z 08012KT 9999 FEW020 30/22 Q1016", "obsTime": 1794578400},
              {"icaoId": "MDSD", "obsTime": 1794582000},
              {"icaoId": " mdpc ", "rawOb": "MDPC 131500Z 09014KT 9999 FEW018 29/22 Q1015", "obsTime": 1794582000},
              {"icaoId": "TJSJ", "rawOb": "TJSJ 131456Z 07018KT 10SM SCT020 27/21 A3001", "obsTime": "2026-11-13T14:56:00Z"},
              {"icaoId": "MDPC", "rawOb": "MDPC 131300Z 08010KT 9999 FEW020 29/22 Q1016", "obsTime": 1794574800}
            ]
            """);
        Assert.Equal(AviationWeatherReadKind.Report, kind);
        Assert.NotNull(reports);
        Assert.Equal(["MDPC", "TJSJ"], reports.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(("MDPC 131500Z 09014KT 9999 FEW018 29/22 Q1015", At1500), (reports["MDPC"].Raw, reports["MDPC"].ObservedAt));

        // The codes asked for may come in any case; the answer is keyed in upper case and cannot be changed.
        using (var document = JsonDocument.Parse("""[{"icaoId": "MDPC", "rawOb": "MDPC 131500Z", "obsTime": 1794582000}]"""))
        {
            var parsed = AviationWeatherParser.ParseMetars(document.RootElement, [" mdpc "]).Reports;
            Assert.NotNull(parsed);
            Assert.Equal(["MDPC"], parsed.Keys);
            Assert.False(parsed is IDictionary<string, AerodromeMetar> { IsReadOnly: false });
        }

        // TAFs: the latest issue of each airport, and one without a validity that ends after it starts is left out.
        const string validity = """ "validTimeFrom": 1794571200, "validTimeTo": 1794657600 """;
        var tafs = Tafs($$"""
            [{"icaoId": "MDPC", "rawTAF": "TAF MDPC 131100Z 1312/1412 09012KT", "issueTime": 1794567600, {{validity}}},
             {"icaoId": "MDPC", "rawTAF": "TAF MDPC 131400Z 1312/1412 08010KT", "issueTime": "2026-11-13 14:00:00", {{validity}}},
             {"icaoId": "MDSD", "rawTAF": "TAF MDSD 131100Z 1312/1412 VRB03KT", "issueTime": 1794567600,
              "validTimeFrom": 1794571200, "validTimeTo": 1794571200}]
            """);
        Assert.Equal(AviationWeatherReadKind.Report, tafs.Kind);
        Assert.NotNull(tafs.Reports);
        Assert.Equal(["MDPC"], tafs.Reports.Keys);
        Assert.Equal("TAF MDPC 131400Z 1312/1412 08010KT", tafs.Reports["MDPC"].Raw);
        Assert.Equal((AviationWeatherReadKind.NoReport, (IReadOnlyDictionary<string, AerodromeTaf>?)null), Tafs("[]"));
    }

    [Theory]
    [InlineData("https://aviationweather.gov/api/data/", "https://aviationweather.gov/api/data/")]
    [InlineData("https://weather.example/mirror/api/data", "https://weather.example/mirror/api/data/")]
    public async Task SendsOneQueryOfEachKindForTheWholeRegion(string baseUrl, string expected)
    {
        var handler = new StubHandler(_ => Json("[]"));
        using var source = new AviationWeatherRegionSource(new HttpClient(handler), new Uri(baseUrl), new ManualClock(Start));

        // Each code trimmed and in upper case, once and sorted; a code that is not four letters is never sent.
        await source.ReadAsync([" tjsj ", "MDSD", "mdsd", "MDPC", "PUJ", "MD1C", "", null!], TestContext.Current.CancellationToken);

        Assert.Equal(expected, source.BaseUrl.AbsoluteUri);
        Assert.Equal([$"{expected}metar?ids=MDPC,MDSD,TJSJ&format=json", $"{expected}taf?ids=MDPC,MDSD,TJSJ&format=json"],
            handler.Requests.Select(request => request.Uri).Order(StringComparer.Ordinal));
        Assert.All(handler.Requests, request =>
        {
            Assert.Equal(HttpMethod.Get, request.Method);
            // The same generic product name the airport read and the traffic networks send.
            Assert.Equal((ReadsbAirTrafficProvider.UserAgent, "application/json"), (request.UserAgent, request.Accept));
            foreach (var revealing in Revealing)
                Assert.DoesNotContain(revealing, request.UserAgent, StringComparison.OrdinalIgnoreCase);
        });

        // Punta Cana's region: its 32 airports in one query of each kind.
        var codes = RegionWeatherStations.AroundPuntaCana.Select(station => station.IcaoCode).ToArray();
        Assert.Equal(32, codes.Length);
        var ids = string.Join(',', codes.Order(StringComparer.Ordinal));
        Assert.Equal($"{expected}metar?ids={ids}&format=json", source.MetarQuery(codes).AbsoluteUri);
        Assert.Equal($"{expected}taf?ids={ids}&format=json", source.TafQuery(codes).AbsoluteUri);
    }

    [Fact]
    public async Task WithoutAnAirportToAskForNothingIsSentAndARegionHasAtMostSixtyFourAirports()
    {
        var handler = new StubHandler(_ => Json(Fixture(MetarFixture)));
        using var source = Source(handler);
        var cancellationToken = TestContext.Current.CancellationToken;

        var none = await source.ReadAsync(["PUJ", "MD1C", " "], cancellationToken);
        Assert.NotNull(none);
        Assert.Equal((0, false, 0, (WeatherServiceFailure?)null, (DateTimeOffset?)null),
            (none.Metars.Count, none.MetarsKeptAfterFailure, none.Tafs.Count, none.MetarFailure, none.MetarRetryAt));
        Assert.Empty(handler.Requests);

        // Sixty-four codes travel in one query; sixty-five are refused before anything is sent.
        var codes = Enumerable.Range(0, AviationWeatherRegionSource.MaxAirports + 1)
            .Select(index => $"K{(char)('A' + index / 26)}{(char)('A' + index % 26)}A").ToArray();
        Assert.Equal(64, AviationWeatherRegionSource.MaxAirports);
        Assert.NotNull(await source.ReadAsync(codes[..^1], cancellationToken));
        Assert.Equal(2, handler.Requests.Count);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => source.ReadAsync(codes, cancellationToken));
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task CachesWithinItsTtlAndServesStaleOnFailure()
    {
        var clock = new ManualClock(Start);
        var metarAnswer = Answering(Fixture(MetarFixture));
        var tafAnswer = Answering(Fixture(TafFixture));
        var handler = new StubHandler(request => IsMetar(request) ? metarAnswer() : tafAnswer());
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;

        var first = await Read(source, cancellationToken);
        Assert.Equal((5, 4), (first.Metars.Count, first.Tafs.Count));
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));

        // Within five minutes the service is not asked again, however many times the region is read.
        clock.Now = Start.AddMinutes(5).AddSeconds(-1);
        var current = await Read(source, cancellationToken);
        Assert.Same(first.Metars, current.Metars);
        Assert.Same(first.Tafs, current.Tafs);
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));

        // At five minutes only the METARs are asked again; the service fails, and those read before are kept, marked, with
        // how it failed and when the service is asked again (a minute later).
        metarAnswer = Answering(HttpStatusCode.InternalServerError);
        tafAnswer = Answering(HttpStatusCode.InternalServerError);
        clock.Now = Start.AddMinutes(5);
        var kept = await Read(source, cancellationToken);
        Assert.Equal((2, 1), (handler.Count("metar"), handler.Count("taf")));
        Assert.Same(first.Metars, kept.Metars);
        Assert.Equal((true, (WeatherServiceFailure?)WeatherServiceFailure.Failed, (DateTimeOffset?)Start.AddMinutes(6)),
            (kept.MetarsKeptAfterFailure, kept.MetarFailure, kept.MetarRetryAt));
        Assert.Same(first.Tafs, kept.Tafs);

        // The TAFs are asked again at thirty minutes, and kept when that fails.
        clock.Now = Start.AddMinutes(30);
        Assert.Same(first.Tafs, (await Read(source, cancellationToken)).Tafs);
        Assert.Equal(2, handler.Count("taf"));

        // The METARs are served up to two hours after they were read, then no longer; the failure is still said.
        clock.Now = Start.AddHours(2).AddSeconds(-1);
        var lastKept = await Read(source, cancellationToken);
        Assert.Same(first.Metars, lastKept.Metars);
        Assert.True(lastKept.MetarsKeptAfterFailure);
        clock.Now = Start.AddHours(2);
        var withoutMetars = await Read(source, cancellationToken);
        Assert.Equal((0, false, (WeatherServiceFailure?)WeatherServiceFailure.Failed),
            (withoutMetars.Metars.Count, withoutMetars.MetarsKeptAfterFailure, withoutMetars.MetarFailure));
        Assert.NotNull(withoutMetars.MetarRetryAt);

        // The TAFs up to twelve hours, each only while it is valid: Samaná's ended at 16:00.
        Assert.Equal(["MDPC", "MDSD", "TJSJ"], withoutMetars.Tafs.Keys.Order(StringComparer.Ordinal));
        clock.Now = Start.AddHours(12).AddSeconds(-1);
        Assert.Equal(3, (await Read(source, cancellationToken)).Tafs.Count);
        clock.Now = Start.AddHours(12);
        Assert.Empty((await Read(source, cancellationToken)).Tafs);

        // Once the service answers again, everything is current and nothing is marked.
        metarAnswer = Answering(Fixture(MetarFixture));
        tafAnswer = Answering(Fixture(TafFixture));
        clock.Advance(TimeSpan.FromMinutes(15));
        var back = await Read(source, cancellationToken);
        Assert.Equal((5, 3, false, (WeatherServiceFailure?)null, (DateTimeOffset?)null),
            (back.Metars.Count, back.Tafs.Count, back.MetarsKeptAfterFailure, back.MetarFailure, back.MetarRetryAt));
    }

    [Fact]
    public async Task ATafIsNeverServedPastItsValidity()
    {
        var clock = new ManualClock(Start);
        var handler = new StubHandler(request => Json(Fixture(IsMetar(request) ? MetarFixture : TafFixture)));
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;

        // Samaná's TAF is valid until 16:00: served a second before, never at 16:00, even when the service sends it again.
        Assert.Contains("MDCY", (await Read(source, cancellationToken)).Tafs.Keys);
        clock.Now = new DateTimeOffset(2026, 11, 13, 15, 59, 59, TimeSpan.Zero);
        Assert.Contains("MDCY", (await Read(source, cancellationToken)).Tafs.Keys);
        Assert.Equal(2, handler.Count("taf"));
        clock.Now = new DateTimeOffset(2026, 11, 13, 16, 0, 0, TimeSpan.Zero);
        Assert.Equal(["MDPC", "MDSD", "TJSJ"], (await Read(source, cancellationToken)).Tafs.Keys.Order(StringComparer.Ordinal));
        clock.Advance(TimeSpan.FromMinutes(30));
        Assert.DoesNotContain("MDCY", (await Read(source, cancellationToken)).Tafs.Keys);
        Assert.Equal(3, handler.Count("taf"));
    }

    [Fact]
    public async Task TooManyRequestsIsWaitedOutAndSaysItWasRateLimited()
    {
        var clock = new ManualClock(Start);
        var metarAnswer = Answering(Fixture(MetarFixture));
        var handler = new StubHandler(request => IsMetar(request) ? metarAnswer() : Json(Fixture(TafFixture)));
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;
        var first = await Read(source, cancellationToken);

        // A 429 that asks for thirty minutes: the METARs read before are kept, the failure says why and when.
        metarAnswer = () => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
            { Headers = { RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromMinutes(30)) } };
        clock.Now = Start.AddMinutes(5);
        var limited = await Read(source, cancellationToken);
        Assert.Same(first.Metars, limited.Metars);
        Assert.Equal((true, (WeatherServiceFailure?)WeatherServiceFailure.RateLimited, (DateTimeOffset?)Start.AddMinutes(35)),
            (limited.MetarsKeptAfterFailure, limited.MetarFailure, limited.MetarRetryAt));

        // Nothing is sent before the wait ends, and once it has the service is asked again.
        clock.Now = Start.AddMinutes(35).AddSeconds(-1);
        await Read(source, cancellationToken);
        Assert.Equal(2, handler.Count("metar"));
        clock.Now = Start.AddMinutes(35);
        metarAnswer = Answering(Fixture(MetarFixture));
        var back = await Read(source, cancellationToken);
        Assert.Equal(3, handler.Count("metar"));
        Assert.Equal((false, (WeatherServiceFailure?)null, (DateTimeOffset?)null),
            (back.MetarsKeptAfterFailure, back.MetarFailure, back.MetarRetryAt));
    }

    [Theory]
    [InlineData("not json", WeatherServiceFailure.Failed)]
    [InlineData("{}", WeatherServiceFailure.Failed)]
    [InlineData("""[{"icaoId": "MDPC"}, {"icaoId": "MDSD", "obsTime": 1794582000}]""", WeatherServiceFailure.Failed)]
    [InlineData("timeout", WeatherServiceFailure.Failed)]
    [InlineData("connection refused", WeatherServiceFailure.Failed)]
    [InlineData("too many requests", WeatherServiceFailure.RateLimited)]
    [InlineData("server error", WeatherServiceFailure.Failed)]
    [InlineData("redirect", WeatherServiceFailure.Failed)]
    public async Task BadJsonATimeoutOrAServerErrorIsAFailure(string answer, WeatherServiceFailure failure)
    {
        var clock = new ManualClock(Start);
        var handler = new StubHandler(_ => answer switch
        {
            // What HttpClient throws when its own limit runs out.
            "timeout" => throw new TaskCanceledException("The request was canceled.", new TimeoutException()),
            "connection refused" => throw new HttpRequestException("Connection refused."),
            "too many requests" => new HttpResponseMessage(HttpStatusCode.TooManyRequests),
            "server error" => new HttpResponseMessage(HttpStatusCode.InternalServerError),
            // A redirect is never followed.
            "redirect" => new HttpResponseMessage(HttpStatusCode.Found)
                { Headers = { Location = new Uri("https://mirror.example/api/data/metar?ids=MDPC&format=json") } },
            _ => Json(answer),
        });
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;

        var weather = await Read(source, cancellationToken);

        Assert.Equal((0, false, 0, (WeatherServiceFailure?)failure, (DateTimeOffset?)Start.AddMinutes(1)),
            (weather.Metars.Count, weather.MetarsKeptAfterFailure, weather.Tafs.Count, weather.MetarFailure,
                weather.MetarRetryAt));
        Assert.Equal(2, handler.Requests.Count);
        // A failure: the service is asked again only after its wait, a minute after the first one.
        clock.Advance(TimeSpan.FromSeconds(59));
        await Read(source, cancellationToken);
        Assert.Equal(2, handler.Requests.Count);
        clock.Advance(TimeSpan.FromSeconds(1));
        await Read(source, cancellationToken);
        Assert.Equal(4, handler.Requests.Count);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("204")]
    [InlineData("other airports")]
    public async Task AnEmptyAnswerMeansNoReportAndNoFailure(string answer)
    {
        var clock = new ManualClock(Start);
        var handler = new StubHandler(_ => answer switch
        {
            "204" => new HttpResponseMessage(HttpStatusCode.NoContent),
            "other airports" => Json("""
                [{"icaoId": "KMIA", "rawOb": "KMIA 131500Z 12008KT 10SM FEW025 28/20 A3002", "obsTime": 1794582000}]
                """),
            _ => Json(answer),
        });
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;

        var none = await Read(source, cancellationToken);
        Assert.Equal((0, false, 0, (WeatherServiceFailure?)null, (DateTimeOffset?)null),
            (none.Metars.Count, none.MetarsKeptAfterFailure, none.Tafs.Count, none.MetarFailure, none.MetarRetryAt));

        // The absence is kept like a report: nothing is asked within five minutes (a failure would be asked after one).
        clock.Advance(TimeSpan.FromMinutes(4));
        await Read(source, cancellationToken);
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));
        clock.Advance(TimeSpan.FromMinutes(1));
        await Read(source, cancellationToken);
        Assert.Equal((2, 1), (handler.Count("metar"), handler.Count("taf")));
    }

    [Fact]
    public async Task ConcurrentRequestsShareOneRead()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var bothSent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sent = 0;
        var cancelledWhenAnswered = new ConcurrentQueue<bool>();
        var handler = new StubHandler(async (request, token) =>
        {
            if (Interlocked.Increment(ref sent) == 2) bothSent.TrySetResult();
            await release.Task;
            cancelledWhenAnswered.Enqueue(token.IsCancellationRequested);
            return Json(Fixture(IsMetar(request) ? MetarFixture : TafFixture));
        });
        using var source = Source(handler);
        using var leaving = new CancellationTokenSource();

        // The first caller starts both reads; two that come while they are on their way, with the same region in another
        // order and case, wait for them.
        var first = source.ReadAsync(Region, leaving.Token);
        await bothSent.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
        var second = source.ReadAsync([.. Enumerable.Reverse(Region)], cancellationToken);
        var third = source.ReadAsync([.. Region.Select(code => code.ToLowerInvariant())], cancellationToken);

        // The caller who started them gives up: it stops waiting at once, and the reads go on for the others.
        await leaving.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        Assert.False(second.IsCompleted);
        Assert.False(third.IsCompleted);

        release.SetResult();
        var answers = await Task.WhenAll(second, third);

        // One METAR request and one TAF request for the three callers, and neither was cancelled.
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));
        Assert.Equal(2, cancelledWhenAnswered.Count);
        Assert.All(cancelledWhenAnswered, Assert.False);
        Assert.All(answers, answer =>
        {
            Assert.NotNull(answer);
            Assert.Equal((5, 4), (answer.Metars.Count, answer.Tafs.Count));
        });
        Assert.Same(answers[0]?.Metars, answers[1]?.Metars);
    }

    [Fact]
    public async Task TheCallersCancellationIsThrown()
    {
        var handler = new StubHandler(_ => Json(Fixture(MetarFixture)));
        using var source = Source(handler);
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => source.ReadAsync(Region, cancellation.Token));
        // A caller that has already given up sends nothing.
        Assert.Empty(handler.Requests);
    }

    private static (AviationWeatherReadKind Kind, IReadOnlyDictionary<string, AerodromeMetar>? Reports) Metars(string json)
    {
        using var document = JsonDocument.Parse(json);
        return AviationWeatherParser.ParseMetars(document.RootElement, Region);
    }

    private static (AviationWeatherReadKind Kind, IReadOnlyDictionary<string, AerodromeTaf>? Reports) Tafs(string json)
    {
        using var document = JsonDocument.Parse(json);
        return AviationWeatherParser.ParseTafs(document.RootElement, Region);
    }

    private static async Task<RegionWeatherData> Read(AviationWeatherRegionSource source, CancellationToken cancellationToken) =>
        await source.ReadAsync(Region, cancellationToken) ?? throw new InvalidOperationException("The source is disabled.");

    private static AviationWeatherRegionSource Source(StubHandler handler, TimeProvider? clock = null) =>
        new(new HttpClient(handler), DataApi, clock ?? new ManualClock(Start));

    private static bool IsMetar(HttpRequestMessage request) =>
        request.RequestUri!.AbsolutePath.EndsWith("/metar", StringComparison.Ordinal);

    private static string Fixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Infrastructure", "Fixtures", name));

    private static Func<HttpResponseMessage> Answering(string json) => () => Json(json);

    private static Func<HttpResponseMessage> Answering(HttpStatusCode status) => () => new HttpResponseMessage(status);

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed record SentRequest(HttpMethod Method, string Uri, string Product, string UserAgent, string Accept);

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _respond;

        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) =>
            _respond = (request, _) => Task.FromResult(respond(request));

        public StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) => _respond = respond;

        public ConcurrentQueue<SentRequest> Requests { get; } = new();

        /// <summary>The requests of one product: <c>metar</c> or <c>taf</c>.</summary>
        public int Count(string product) => Requests.Count(request => request.Product == product);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var uri = request.RequestUri!;
            Requests.Enqueue(new SentRequest(request.Method, uri.AbsoluteUri,
                uri.AbsolutePath[(uri.AbsolutePath.LastIndexOf('/') + 1)..], request.Headers.UserAgent.ToString(),
                request.Headers.Accept.ToString()));
            return _respond(request, cancellationToken);
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now;

        public void Advance(TimeSpan amount) => Now += amount;
    }
}
