using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.Weather;
using Elevant.Infrastructure.Integrations.AirTraffic;
using Elevant.Infrastructure.Integrations.AviationWeather;
using Elevant.Infrastructure.Integrations.OpenMeteo;
using Elevant.Infrastructure.Integrations.WeatherRadar;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// Plan M6: the sources of the layers of a region's weather, against synthetic answers (never a network). The answers keep
/// the shapes the services answer: the international SIGMETs of aviationweather.gov (<c>isigmet?format=json</c>: one list
/// of every SIGMET in force, each with its <c>coords</c> of <c>{lat, lon}</c>), the current wind of several points of
/// Open-Meteo (<c>forecast?latitude=a,b&amp;longitude=c,d&amp;current=…</c>: one list with a location per point) and the
/// radar index of the Iowa Environmental Mesonet (<c>json/radar.py?operation=list</c>: <c>{"scans": [{"ts": …}]}</c>);
/// every value in them is invented.
/// </summary>
public sealed class RegionWeatherLayerSourcesTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 13, 15, 5, 0, TimeSpan.Zero);
    private const long At1500 = 1794582000;
    private static readonly Uri DataApi = new("https://aviationweather.gov/api/data/");
    private static readonly Uri Forecast = new("https://api.open-meteo.com/v1/");
    private static readonly Uri Iem = new("https://mesonet.agron.iastate.edu/");
    private static readonly RegionWeatherArea Area = RegionWeatherStations.PuntaCanaArea;
    private static readonly string[] Revealing = ["ELEVANT", "AVIAM", "@", "http"];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    // ---- SIGMETs ------------------------------------------------------------------------------------------------------

    /// <summary>
    /// Three SIGMETs of San Juan's FIR and Santo Domingo's over the region, one of New York's far north of it, one whose
    /// area is two rings (only one of them over the region), and two that cannot be read.
    /// </summary>
    private static readonly string SigmetAnswer = $$"""
        [
          {"icaoId": "TJSJ", "firId": "TJZS", "seriesId": "A3", "hazard": "TS", "qualifier": "embd",
           "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500 + 4 * 3600}}, "base": null, "top": 45000,
           "geom": "AREA", "rawSigmet": "TJZS SIGMET A3 VALID 131500/131900 TJSJ- EMBD TS TOP FL450",
           "coords": [{"lat": 18.5, "lon": -67.5}, {"lat": 19.5, "lon": -66.0}, {"lat": 18.0, "lon": -65.0}]},
          {"icaoId": "MDSD", "firId": "MDCS", "seriesId": "B1", "hazard": "TURB", "qualifier": "SEV",
           "validTimeFrom": {{At1500 - 3600}}, "validTimeTo": {{At1500 + 3600}}, "base": 25000, "top": 39000,
           "geom": "AREA", "rawSigmet": "MDCS SIGMET B1 VALID 131400/131600 MDSD- SEV TURB FL250/390",
           "coords": [{"lat": 17.0, "lon": -71.0}, {"lat": 19.0, "lon": -71.0}, {"lat": 19.0, "lon": -69.0},
                      {"lat": 17.0, "lon": -69.0}, {"lat": 17.0, "lon": -71.0}]},
          {"icaoId": "KKCI", "firId": "KZNY", "seriesId": "C2", "hazard": "ICE",
           "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500 + 3600}}, "base": 10000, "top": 20000,
           "geom": "AREA", "rawSigmet": "KZNY SIGMET C2 VALID 131500/131600 KKCI- SEV ICE",
           "coords": [{"lat": 38.0, "lon": -70.0}, {"lat": 40.0, "lon": -70.0}, {"lat": 39.0, "lon": -68.0}]},
          {"icaoId": "TTPP", "firId": "TTZP", "seriesId": "D1", "hazard": "VA", "qualifier": "SOUFRIERE HILLS",
           "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500 + 6 * 3600}}, "base": 0, "top": 999999,
           "geom": "AREAS", "rawSigmet": "TTZP SIGMET D1 VALID 131500/132100 TTPP- VA ERUPTION",
           "coords": [[{"lat": 16.5, "lon": -62.5}, {"lat": 17.0, "lon": -62.0}, {"lat": 16.5, "lon": -61.5}],
                      [{"lat": 5.0, "lon": -50.0}, {"lat": 6.0, "lon": -50.0}, {"lat": 5.5, "lon": -49.0}]]},
          {"icaoId": "TJSJ", "firId": "TJZS", "seriesId": "A4", "hazard": "TS",
           "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500 + 3600}}, "rawSigmet": "TJZS SIGMET A4",
           "coords": [{"lat": 18.5, "lon": -67.5}, {"lat": 19.5, "lon": -66.0}]},
          {"icaoId": "TJSJ", "firId": "TJZS", "seriesId": "A5", "hazard": "TS",
           "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500}}, "rawSigmet": "TJZS SIGMET A5",
           "coords": [{"lat": 18.5, "lon": -67.5}, {"lat": 19.5, "lon": -66.0}, {"lat": 18.0, "lon": -65.0}]}
        ]
        """;

    [Fact]
    public void ReadsTheSigmetsThatTouchTheRegion()
    {
        var (kind, sigmets) = Sigmets(SigmetAnswer);

        Assert.Equal(AviationWeatherReadKind.Report, kind);
        Assert.NotNull(sigmets);
        // New York's is far away, the second ring of the volcanic ash too; one with two points and one that ends when it
        // starts cannot be read.
        Assert.Equal(["TJZS-A3-202611131500", "MDCS-B1-202611131400", "TTZP-D1-202611131500-1"],
            sigmets.Select(sigmet => sigmet.Id));

        var ts = sigmets[0];
        Assert.Equal(("TJZS", "TS", "EMBD", (int?)null, (int?)45000), (ts.FirId, ts.Hazard, ts.Qualifier, ts.BaseFeet, ts.TopFeet));
        Assert.Equal((DateTimeOffset.FromUnixTimeSeconds(At1500), DateTimeOffset.FromUnixTimeSeconds(At1500 + 4 * 3600)),
            (ts.ValidFrom, ts.ValidTo));
        Assert.Equal("TJZS SIGMET A3 VALID 131500/131900 TJSJ- EMBD TS TOP FL450", ts.Raw);
        // Longitude first, and the ring is closed.
        Assert.Equal([new RegionPoint(-67.5, 18.5), new RegionPoint(-66.0, 19.5), new RegionPoint(-65.0, 18.0),
            new RegionPoint(-67.5, 18.5)], ts.Polygon);

        // A ring already closed is not closed again.
        Assert.Equal(5, sigmets[1].Polygon.Count);
        Assert.Equal((25000, 39000), (sigmets[1].BaseFeet, sigmets[1].TopFeet));
        // A level out of its range is null; the volcano's name is its qualifier.
        Assert.Equal(((int?)0, (int?)null, "SOUFRIERE HILLS"), (sigmets[2].BaseFeet, sigmets[2].TopFeet, sigmets[2].Qualifier));
    }

    [Fact]
    public void ASigmetListThatCannotBeReadIsUnreadable()
    {
        // Not a list, or a list whose SIGMETs none can be read: unreadable.
        Assert.Equal(AviationWeatherReadKind.Unreadable, Sigmets("{}").Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Sigmets("null").Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Sigmets($$"""
            [{"firId": "TJZS", "hazard": "TS", "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500 + 3600}},
              "coords": [{"lat": 18.5, "lon": -67.5}, {"lat": 19.5, "lon": -66.0}, {"lat": 18.0, "lon": -65.0}]}]
            """).Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Sigmets($$"""
            [{"firId": "TJZS", "hazard": "TS", "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500 + 3600}}, "rawSigmet": "X",
              "coords": [{"lat": 18.5, "lon": -67.5}, {"lat": 19.5, "lon": -266.0}, {"lat": 18.0, "lon": -65.0}]}]
            """).Kind);

        // An empty list, or SIGMETs far from the region: none, and nothing failed.
        var empty = Sigmets("[]");
        Assert.Equal(AviationWeatherReadKind.Report, empty.Kind);
        Assert.Empty(empty.Sigmets!);
        var far = Sigmets($$"""
            [{"firId": "KZNY", "hazard": "ICE", "validTimeFrom": {{At1500}}, "validTimeTo": {{At1500 + 3600}}, "rawSigmet": "X",
              "coords": [{"lat": 38.0, "lon": -70.0}, {"lat": 40.0, "lon": -70.0}, {"lat": 39.0, "lon": -68.0}]}]
            """);
        Assert.Equal(AviationWeatherReadKind.Report, far.Kind);
        Assert.Empty(far.Sigmets!);
    }

    [Fact]
    public void TheSameSigmetTwiceKeepsAnIdOfItsOwn()
    {
        const string sigmet = """
            {"firId": "TJZS", "seriesId": "A3", "hazard": "TS", "validTimeFrom": 1794582000, "validTimeTo": 1794585600,
             "rawSigmet": "TJZS SIGMET A3", "coords": [{"lat": 18.5, "lon": -67.5}, {"lat": 19.5, "lon": -66.0},
             {"lat": 18.0, "lon": -65.0}]}
            """;
        var (_, sigmets) = Sigmets($"[{sigmet}, {sigmet}]");

        Assert.Equal(["TJZS-A3-202611131500", "TJZS-A3-202611131500-1.2"], sigmets!.Select(item => item.Id));
    }

    [Fact]
    public async Task SendsOneQueryOfTheSigmetsAndKeepsItTenMinutes()
    {
        var clock = new ManualClock(Start);
        var answer = Answering(SigmetAnswer);
        var handler = new StubHandler(_ => answer());
        using var source = new AviationWeatherSigmetSource(new HttpClient(handler), DataApi, clock);

        var first = await source.ReadAsync(Area, Ct);
        Assert.NotNull(first);
        Assert.Equal((3, false, (WeatherServiceFailure?)null, (DateTimeOffset?)null),
            (first.Value!.Count, first.KeptAfterFailure, first.Failure, first.RetryAt));
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://aviationweather.gov/api/data/isigmet?format=json", request.Uri);
        AssertGeneric(request);

        // Within ten minutes the service is not asked again.
        clock.Now = Start.AddMinutes(10).AddSeconds(-1);
        Assert.Same(first.Value, (await source.ReadAsync(Area, Ct))!.Value);
        Assert.Single(handler.Requests);

        // At ten minutes it fails: what was read is kept, marked, with how it failed and when it is asked again.
        answer = Answering(HttpStatusCode.ServiceUnavailable);
        clock.Now = Start.AddMinutes(10);
        var kept = await source.ReadAsync(Area, Ct);
        Assert.Equal((true, (WeatherServiceFailure?)WeatherServiceFailure.Failed, (DateTimeOffset?)Start.AddMinutes(11)),
            (kept!.KeptAfterFailure, kept.Failure, kept.RetryAt));
        Assert.Same(first.Value, kept.Value);

        // Served up to two hours after it was read, then no longer.
        clock.Now = Start.AddHours(2).AddSeconds(-1);
        Assert.NotNull((await source.ReadAsync(Area, Ct))!.Value);
        clock.Now = Start.AddHours(2);
        Assert.Null((await source.ReadAsync(Area, Ct))!.Value);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("204")]
    public async Task NoSigmetIsAnAnswerAndNoFailure(string body)
    {
        var handler = new StubHandler(_ => body == "204" ? new HttpResponseMessage(HttpStatusCode.NoContent) : Json(body));
        using var source = new AviationWeatherSigmetSource(new HttpClient(handler), DataApi, new ManualClock(Start));

        var none = await source.ReadAsync(Area, Ct);

        Assert.Equal((0, false, (WeatherServiceFailure?)null), (none!.Value!.Count, none.KeptAfterFailure, none.Failure));
    }

    [Theory]
    [InlineData("not json", WeatherServiceFailure.Failed)]
    [InlineData("{}", WeatherServiceFailure.Failed)]
    [InlineData("timeout", WeatherServiceFailure.Failed)]
    [InlineData("too many requests", WeatherServiceFailure.RateLimited)]
    [InlineData("redirect", WeatherServiceFailure.Failed)]
    public async Task EachLayerSourceTurnsAFailedReadIntoAFailure(string answer, WeatherServiceFailure failure)
    {
        var clock = new ManualClock(Start);
        var handler = new StubHandler(_ => answer switch
        {
            "timeout" => throw new TaskCanceledException("The request was canceled.", new TimeoutException()),
            "too many requests" => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
                { Headers = { RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromMinutes(30)) } },
            "redirect" => new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://mirror.example/") } },
            _ => Json(answer),
        });
        using var sigmets = new AviationWeatherSigmetSource(new HttpClient(handler), DataApi, clock);
        using var wind = new OpenMeteoWindSource(new HttpClient(handler), Forecast, clock);
        using var radar = new IemRadarSource(new HttpClient(handler), Iem, clock);
        var retryAt = failure == WeatherServiceFailure.RateLimited ? Start.AddMinutes(30) : Start.AddMinutes(1);

        var layers = new (bool HasValue, bool Kept, WeatherServiceFailure? Failure, DateTimeOffset? RetryAt)[]
        {
            Shape(await sigmets.ReadAsync(Area, Ct)), Shape(await wind.ReadAsync(Area, Ct)), Shape(await radar.ReadAsync(Area, Ct)),
        };

        Assert.All(layers, layer => Assert.Equal((false, false, (WeatherServiceFailure?)failure, (DateTimeOffset?)retryAt), layer));
        Assert.Equal(3, handler.Requests.Count);
        // Nothing is asked again before the wait ends.
        clock.Now = retryAt.AddSeconds(-1);
        await sigmets.ReadAsync(Area, Ct);
        await wind.ReadAsync(Area, Ct);
        await radar.ReadAsync(Area, Ct);
        Assert.Equal(3, handler.Requests.Count);
    }

    // ---- Wind ---------------------------------------------------------------------------------------------------------

    [Fact]
    public void TheWindGridIsEvenlySpreadOverTheRegion()
    {
        var points = OpenMeteoWindParser.Points(Area, RegionWindGridShape.Columns, RegionWindGridShape.Rows);

        // Ten columns by eight rows: 80 points, south to north and west to east within each row, the edges included.
        Assert.Equal((10, 8, 80), (RegionWindGridShape.Columns, RegionWindGridShape.Rows, points.Count));
        Assert.Equal(new RegionPoint(-76, 12), points[0]);
        Assert.Equal(new RegionPoint(-60, 12), points[9]);
        Assert.Equal(new RegionPoint(-74.222, 12), points[1]);
        Assert.Equal(new RegionPoint(-76, 13.714), points[10]);
        Assert.Equal(new RegionPoint(-60, 24), points[^1]);

        Assert.Throws<ArgumentOutOfRangeException>(() => OpenMeteoWindParser.Points(Area, 1, 8));
    }

    [Fact]
    public void AsksForTheCurrentWindOfEveryPointAtOnceInKnots()
    {
        var points = OpenMeteoWindParser.Points(new RegionWeatherArea(-70, -68, 18, 19, null), 2, 2);

        Assert.Equal("https://api.open-meteo.com/v1/forecast?latitude=18,18,19,19&longitude=-70,-68,-70,-68" +
            "&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timeformat=unixtime",
            OpenMeteoWindParser.Query(Forecast, points).AbsoluteUri);
    }

    [Fact]
    public void ReadsTheWindOfEachPoint()
    {
        var area = new RegionWeatherArea(-70, -68, 18, 19, null);
        var (kind, grid) = Wind($$"""
            [
              {"latitude": 18.0, "longitude": -70.0, "current": {"time": {{At1500 - 900}}, "wind_speed_10m": 12.34, "wind_direction_10m": 85} },
              {"latitude": 18.0, "longitude": -67.98, "current": {"time": {{At1500}}, "wind_speed_10m": 0, "wind_direction_10m": 359.6} },
              {"latitude": 19.0, "longitude": -70.0, "current": {"time": {{At1500}}, "wind_speed_10m": -1, "wind_direction_10m": 90} },
              {"latitude": 19.0, "longitude": -68.0, "current": {"time": {{At1500}}, "wind_speed_10m": 20} }
            ]
            """, area);

        Assert.Equal(AviationWeatherReadKind.Report, kind);
        Assert.NotNull(grid);
        // A negative speed and a missing direction are left out; the points keep the coordinates asked for, the speed is
        // rounded to tenths and the direction to whole degrees. The grid is valid at its latest time.
        Assert.Equal([new RegionWindPoint(18, -70, 12.3, 85), new RegionWindPoint(18, -68, 0, 360)], grid.Points);
        Assert.Equal((DateTimeOffset.FromUnixTimeSeconds(At1500), area, 2, 2), (grid.ValidAt, grid.Area, grid.Columns, grid.Rows));

        // Another number of locations, or none with a wind: unreadable.
        Assert.Equal(AviationWeatherReadKind.Unreadable, Wind("[]", area).Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Wind("""{"error": true, "reason": "x"}""", area).Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Wind("""[{"current": {}}, {}, {}, {}]""", area).Kind);
    }

    [Fact]
    public async Task SendsOneWindQueryAndKeepsItAnHour()
    {
        var clock = new ManualClock(Start);
        var answer = Answering(WindAnswer(80));
        var handler = new StubHandler(_ => answer());
        using var source = new OpenMeteoWindSource(new HttpClient(handler), Forecast, clock);

        var first = await source.ReadAsync(Area, Ct);
        Assert.Equal((80, false, (WeatherServiceFailure?)null), (first!.Value!.Points.Count, first.KeptAfterFailure, first.Failure));
        var request = Assert.Single(handler.Requests);
        Assert.StartsWith("https://api.open-meteo.com/v1/forecast?latitude=12,12,", request.Uri, StringComparison.Ordinal);
        Assert.Equal(80, request.Uri.Split("latitude=")[1].Split('&')[0].Split(',').Length);
        Assert.EndsWith("&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timeformat=unixtime", request.Uri,
            StringComparison.Ordinal);
        AssertGeneric(request);

        clock.Now = Start.AddHours(1).AddSeconds(-1);
        Assert.Same(first.Value, (await source.ReadAsync(Area, Ct))!.Value);
        Assert.Single(handler.Requests);

        // Open-Meteo answers its errors as a 400: a failure, and the grid kept is served up to three hours, marked.
        answer = () => new HttpResponseMessage(HttpStatusCode.BadRequest)
            { Content = new StringContent("""{"error": true, "reason": "x"}""", Encoding.UTF8, "application/json") };
        clock.Now = Start.AddHours(1);
        var kept = await source.ReadAsync(Area, Ct);
        Assert.Equal((true, (WeatherServiceFailure?)WeatherServiceFailure.Failed), (kept!.KeptAfterFailure, kept.Failure));
        Assert.Same(first.Value, kept.Value);
        clock.Now = Start.AddHours(3);
        Assert.Null((await source.ReadAsync(Area, Ct))!.Value);
    }

    [Fact]
    public async Task AWindAnswerWithoutContentIsAFailure()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NoContent));
        using var source = new OpenMeteoWindSource(new HttpClient(handler), Forecast, new ManualClock(Start));

        var layer = await source.ReadAsync(Area, Ct);

        Assert.Equal((false, (WeatherServiceFailure?)WeatherServiceFailure.Failed), (layer!.Value is not null, layer.Failure));
    }

    // ---- Radar --------------------------------------------------------------------------------------------------------

    [Fact]
    public void NamesTheIemSiteItsIndexAndItsTiles()
    {
        Assert.Equal(("JUA", "JUA", (string?)null, (string?)null), (IemRadarParser.IemSite("TJUA"), IemRadarParser.IemSite(" tjua "),
            IemRadarParser.IemSite("JUA"), IemRadarParser.IemSite("TJ1A")));
        Assert.Equal("iem-tjua", IemRadarParser.Provider("TJUA"));

        // The index of the last two hours, to the minute.
        Assert.Equal("https://mesonet.agron.iastate.edu/json/radar.py?operation=list&product=N0B&radar=JUA" +
            "&start=2026-11-13T13:05Z&end=2026-11-13T15:05Z", IemRadarParser.Query(Iem, "JUA", Start.AddSeconds(42)).AbsoluteUri);
        // The tiles of one scan in the IEM's TMS cache, as XYZ.
        Assert.Equal("https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-202611131457/{z}/{x}/{y}.png",
            IemRadarParser.TileUrlTemplate(Iem, "JUA", new DateTimeOffset(2026, 11, 13, 14, 57, 0, TimeSpan.Zero)));
    }

    [Fact]
    public void ReadsTheLatestScansOldestFirst()
    {
        var scans = string.Join(", ", Enumerable.Range(0, 14).Reverse()
            .Select(index => $$"""{"ts": "{{Start.AddMinutes(-5 * index).UtcDateTime:yyyy-MM-dd'T'HH:mm}}Z"}"""));
        var (kind, frames) = Radar($$"""
            {"scans": [{{scans}}, {"ts": "2026-11-13T15:05:30Z"}, {"ts": "yesterday"}, 42], "generated_at": "x"}
            """);

        Assert.Equal(AviationWeatherReadKind.Report, kind);
        Assert.NotNull(frames);
        Assert.Equal(("iem-tjua", 10), (frames.Provider, frames.MaxZoom));
        // Twelve frames, the latest scans; two in the same minute are one, and one without a time is left out.
        Assert.Equal(IemRadarParser.MaxFrames, frames.Frames.Count);
        Assert.Equal(Enumerable.Range(0, 12).Reverse().Select(index => Start.AddMinutes(-5 * index)),
            frames.Frames.Select(frame => frame.Time));
        Assert.Equal("https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-202611131505/{z}/{x}/{y}.png",
            frames.Frames[^1].TileUrlTemplate);

        // No scan: a report without frames. Not an object with a list of scans: unreadable.
        Assert.Empty(Radar("""{"scans": []}""").Frames!.Frames);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Radar("[]").Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Radar("""{"scans": {}}""").Kind);
    }

    [Fact]
    public async Task ReadsTheRadarIndexOnceInFiveMinutes()
    {
        var clock = new ManualClock(Start);
        var handler = new StubHandler(_ => Json("""{"scans": [{"ts": "2026-11-13T15:01Z"}]}"""));
        using var source = new IemRadarSource(new HttpClient(handler), Iem, clock);

        var first = await source.ReadAsync(Area, Ct);
        Assert.Equal((1, false, (WeatherServiceFailure?)null), (first!.Value!.Frames.Count, first.KeptAfterFailure, first.Failure));
        var request = Assert.Single(handler.Requests);
        Assert.Equal(IemRadarParser.Query(Iem, "JUA", Start).AbsoluteUri, request.Uri);
        AssertGeneric(request);

        clock.Now = Start.AddMinutes(5).AddSeconds(-1);
        await source.ReadAsync(Area, Ct);
        Assert.Single(handler.Requests);
        clock.Now = Start.AddMinutes(5);
        await source.ReadAsync(Area, Ct);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task ARegionWithoutARadarSiteSendsNothing()
    {
        var handler = new StubHandler(_ => Json("""{"scans": []}"""));
        using var source = new IemRadarSource(new HttpClient(handler), Iem, new ManualClock(Start));

        foreach (var site in new string?[] { null, "JUA", "T1UA" })
        {
            var layer = await source.ReadAsync(Area with { RadarSite = site }, Ct);
            Assert.Equal(((RegionRadarFrames?)null, (WeatherServiceFailure?)null), (layer!.Value, layer.Failure));
        }
        Assert.Empty(handler.Requests);

        // A 204 is an index without scans.
        using var empty = new IemRadarSource(new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NoContent))),
            Iem, new ManualClock(Start));
        Assert.Empty((await empty.ReadAsync(Area, Ct))!.Value!.Frames);
    }

    [Fact]
    public async Task ConcurrentLayerReadsShareOneRequestAndTheCallersCancellationIsThrown()
    {
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var sent = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new StubHandler(async (_, _) =>
        {
            sent.TrySetResult();
            await release.Task;
            return Json(SigmetAnswer);
        });
        using var source = new AviationWeatherSigmetSource(new HttpClient(handler), DataApi, new ManualClock(Start));
        using var leaving = new CancellationTokenSource();

        var first = source.ReadAsync(Area, leaving.Token);
        await sent.Task.WaitAsync(TimeSpan.FromSeconds(10), Ct);
        var second = source.ReadAsync(Area, Ct);
        await leaving.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        release.SetResult();

        Assert.Equal(3, (await second)!.Value!.Count);
        Assert.Single(handler.Requests);

        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => source.ReadAsync(Area, cancelled.Token));
        Assert.Single(handler.Requests);
    }

    [Theory]
    [InlineData("http://example.test/")]
    [InlineData("https://example.test/?q=1")]
    public void EachLayerSourceRefusesAnAddressThatIsNotHttps(string address)
    {
        var uri = new Uri(address);
        Assert.Throws<ArgumentException>(() => new AviationWeatherSigmetSource(new HttpClient(), uri, TimeProvider.System));
        Assert.Throws<ArgumentException>(() => new OpenMeteoWindSource(new HttpClient(), uri, TimeProvider.System));
        Assert.Throws<ArgumentException>(() => new IemRadarSource(new HttpClient(), uri, TimeProvider.System));
    }

    private static (bool, bool, WeatherServiceFailure?, DateTimeOffset?) Shape<T>(RegionWeatherLayer<T>? layer) where T : class =>
        (layer!.Value is not null, layer.KeptAfterFailure, layer.Failure, layer.RetryAt);

    private static string WindAnswer(int locations) => "[" + string.Join(",", Enumerable.Range(0, locations).Select(index =>
        $$"""{"current": {"time": {{At1500}}, "wind_speed_10m": {{index % 30}}, "wind_direction_10m": {{index * 4 % 360}} } }""")) + "]";

    private static (AviationWeatherReadKind Kind, IReadOnlyList<RegionSigmet>? Sigmets) Sigmets(string json)
    {
        using var document = JsonDocument.Parse(json);
        return AviationWeatherSigmetParser.Parse(document.RootElement, Area);
    }

    private static (AviationWeatherReadKind Kind, RegionWindGrid? Grid) Wind(string json, RegionWeatherArea area)
    {
        using var document = JsonDocument.Parse(json);
        return OpenMeteoWindParser.Parse(document.RootElement, area, 2, 2);
    }

    private static (AviationWeatherReadKind Kind, RegionRadarFrames? Frames) Radar(string json)
    {
        using var document = JsonDocument.Parse(json);
        return IemRadarParser.Parse(document.RootElement, Iem, "TJUA");
    }

    private static void AssertGeneric(SentRequest request)
    {
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal((ReadsbAirTrafficProvider.UserAgent, "application/json"), (request.UserAgent, request.Accept));
        foreach (var revealing in Revealing)
            Assert.DoesNotContain(revealing, request.UserAgent, StringComparison.OrdinalIgnoreCase);
    }

    private static Func<HttpResponseMessage> Answering(string json) => () => Json(json);

    private static Func<HttpResponseMessage> Answering(HttpStatusCode status) => () => new HttpResponseMessage(status);

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    private sealed record SentRequest(HttpMethod Method, string Uri, string UserAgent, string Accept);

    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> _respond;

        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) =>
            _respond = (request, _) => Task.FromResult(respond(request));

        public StubHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) => _respond = respond;

        public ConcurrentQueue<SentRequest> Requests { get; } = new();

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Requests.Enqueue(new SentRequest(request.Method, request.RequestUri!.AbsoluteUri,
                request.Headers.UserAgent.ToString(), request.Headers.Accept.ToString()));
            return _respond(request, cancellationToken);
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now;
    }
}
