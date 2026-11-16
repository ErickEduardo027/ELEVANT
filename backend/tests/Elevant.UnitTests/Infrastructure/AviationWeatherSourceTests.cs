using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Integrations.AirTraffic;
using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0043 (contracts 1.4): the aviationweather.gov source of the OCC's METAR and TAF, against synthetic answers (never a
/// network). The fixtures keep the shape the Data API documents for <c>metar?…&amp;format=json</c> and
/// <c>taf?…&amp;format=json</c> (a list of reports with <c>icaoId</c>, <c>rawOb</c> or <c>rawTAF</c>, Unix and ISO times,
/// <c>clouds</c> and <c>fcsts</c>); every value in them is invented.
/// </summary>
public sealed class AviationWeatherSourceTests
{
    private const string MetarFixture = "awc-metar.synthetic.json";
    private const string TafFixture = "awc-taf.synthetic.json";
    private static readonly DateTimeOffset Start = new(2026, 11, 13, 15, 5, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ObservedAt = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset TafFrom = new(2026, 11, 13, 12, 0, 0, TimeSpan.Zero);
    private static readonly Uri DataApi = new("https://aviationweather.gov/api/data/");
    // What a User-Agent must not carry: the project, the company, an address or a link.
    private static readonly string[] Revealing = ["ELEVANT", "AVIAM", "@", "http"];

    [Fact]
    public async Task ParsesTheMetarAndTaf()
    {
        var handler = new StubHandler(request => Json(Fixture(IsMetar(request) ? MetarFixture : TafFixture)));
        using var source = Source(handler);

        var weather = await Read(source, TestContext.Current.CancellationToken);

        Assert.Equal(("MDPC", false, (DateTimeOffset?)Start), (weather.IcaoCode, weather.MetarKeptAfterFailure, weather.RetrievedAt));
        // The latest of the two observations, dated by its obsTime; «6+» is six miles, Q1015 already hectopascals.
        var metar = weather.Metar;
        Assert.NotNull(metar);
        Assert.Equal(new AerodromeMetar("MDPC 131500Z 09014G24KT 9999 VCSH FEW018 SCT035 BKN080 29/22 Q1015 NOSIG", ObservedAt,
            "VFR", 90, false, 14, 24, 6, 29, 22, 1015, "VCSH", metar.Clouds), metar);
        Assert.Equal([new AerodromeCloudLayer("FEW", 1800), new AerodromeCloudLayer("SCT", 3500),
            new AerodromeCloudLayer("BKN", 8000)], metar.Clouds);

        // The TAF: issued as an ISO text, valid in Unix seconds, and its four periods in their order.
        var taf = weather.Taf;
        Assert.NotNull(taf);
        Assert.Equal(("TAF MDPC 131100Z 1312/1412 09012KT 9999 FEW020 SCT040 TEMPO 1316/1320 10015G25KT 4000 SHRA BKN015 " +
                      "FM132200 07008KT 9999 FEW020 PROB30 1404/1408 3000 TSRA BKN012CB",
                new DateTimeOffset(2026, 11, 13, 11, 0, 0, TimeSpan.Zero), TafFrom, TafFrom.AddHours(24)),
            (taf.Raw, taf.IssuedAt, taf.ValidFrom, taf.ValidTo));
        Assert.Equal(4, taf.Periods.Count);
        AssertPeriod(new(TafFrom, TafFrom.AddHours(10), null, null, 90, false, 12, null, 6, null, []), taf.Periods[0],
            new AerodromeCloudLayer("FEW", 2000), new AerodromeCloudLayer("SCT", 4000));
        AssertPeriod(new(TafFrom.AddHours(4), TafFrom.AddHours(8), "TEMPO", null, 100, false, 15, 25, 2.49, "SHRA", []),
            taf.Periods[1], new AerodromeCloudLayer("BKN", 1500));
        AssertPeriod(new(TafFrom.AddHours(10), TafFrom.AddHours(24), "FM", null, 70, false, 8, null, 6, null, []),
            taf.Periods[2], new AerodromeCloudLayer("FEW", 2000));
        AssertPeriod(new(TafFrom.AddHours(16), TafFrom.AddHours(20), "PROB", 30, null, false, null, null, 1.86, "TSRA", []),
            taf.Periods[3], new AerodromeCloudLayer("BKN", 1200));
    }

    [Theory]
    [InlineData(""" "wdir": "VRB", "wspd": 3, "visib": "10+", "altim": 29.92 """, null, true, 3, null, 10.0, 1013.2)]
    [InlineData(""" "wdir": " vrb ", "wspd": 2, "wgst": null, "visib": "1/4", "altim": 1009.8 """, null, true, 2, null, 0.25, 1009.8)]
    [InlineData(""" "wdir": 270, "wspd": 18, "wgst": 32, "visib": "1 1/2", "altim": 30.05 """, 270, false, 18, 32, 1.5, 1017.6)]
    [InlineData(""" "wdir": 0, "wspd": 0, "visib": 7, "altim": 1013 """, 0, false, 0, null, 7.0, 1013.0)]
    [InlineData(""" "wdir": 360, "wspd": 5, "visib": " 6+ ", "altim": 1012.4 """, 360, false, 5, null, 6.0, 1012.4)]
    [InlineData(""" "wdir": 370, "wspd": -1, "wgst": 301, "visib": "M1/4", "altim": 0 """, null, false, null, null, null, null)]
    [InlineData(""" "wdir": "090", "wspd": "12", "visib": "1 3/2", "altim": "1013" """, null, false, null, null, null, null)]
    [InlineData(""" "visib": "3/0", "altim": 1101 """, null, false, null, null, null, null)]
    public void ReadsVariableWindAndTenPlusVisibility(string fields, int? direction, bool variable, int? speed, int? gust,
        double? miles, double? hectopascals)
    {
        var (kind, metar) = Metar(MetarWith(fields));

        Assert.Equal(AviationWeatherReadKind.Report, kind);
        Assert.NotNull(metar);
        // «VRB» is a variable wind without a direction; a direction beyond 360 or a speed below zero is no value.
        Assert.Equal((direction, variable, speed, gust),
            (metar.WindDirectionDegrees, metar.WindVariable, metar.WindSpeedKnots, metar.WindGustKnots));
        // «10+» is ten miles and fractions are miles; inches of mercury (25 to 35) become hectopascals.
        AssertClose(miles, metar.VisibilityStatuteMiles);
        AssertClose(hectopascals, metar.AltimeterHectopascals);
    }

    [Fact]
    public void PicksTheLatestReadableReportOfTheAirport()
    {
        // Not a list: unreadable. A list without the airport: no report.
        Assert.Equal(AviationWeatherReadKind.Unreadable, Metar("""{"icaoId": "MDPC"}""").Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Metar("\"MDPC\"").Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable, Metar("null").Kind);
        Assert.Equal((AviationWeatherReadKind.NoReport, (AerodromeMetar?)null), Metar("[]"));
        Assert.Equal(AviationWeatherReadKind.NoReport, Metar("""
            [{"icaoId": "MDSD", "rawOb": "MDSD 131500Z 10010KT 9999 FEW020 30/21 Q1014", "obsTime": 1794582000}, "MDPC", 42]
            """).Kind);

        // The airport's code in any case, and the latest report wherever it is in the list.
        var latest = Metar("""
            [
              {"icaoId": "mdpc", "rawOb": "MDPC 131400Z 08012KT 9999 FEW020 30/22 Q1016", "obsTime": 1794578400},
              {"icaoId": " MDPC ", "rawOb": " MDPC 131500Z 09014KT 9999 FEW018 29/22 Q1015 ", "obsTime": 1794582000},
              {"icaoId": "MDPC", "rawOb": "MDPC 131300Z 08010KT 9999 FEW020 29/22 Q1016", "obsTime": 1794574800}
            ]
            """);
        Assert.Equal((AviationWeatherReadKind.Report, "MDPC 131500Z 09014KT 9999 FEW018 29/22 Q1015", (DateTimeOffset?)ObservedAt),
            (latest.Kind, latest.Report?.Raw, latest.Report?.ObservedAt));

        // Without obsTime the time is reportTime; either may be Unix seconds or ISO 8601 with a «T» or a space (no zone is
        // UTC).
        foreach (var time in new[]
                 {
                     """ "reportTime": "2026-11-13T15:00:00.000Z" """, """ "reportTime": "2026-11-13 15:00:00" """,
                     """ "reportTime": "2026-11-13T11:00:00-04:00" """, """ "obsTime": "2026-11-13T15:00:00Z" """,
                     """ "obsTime": "soon", "reportTime": 1794582000 """,
                 })
            Assert.Equal(ObservedAt, Metar($$"""[{"icaoId": "MDPC", "rawOb": "MDPC 131500Z 09014KT", {{time}}}]""").Report?.ObservedAt);

        // Without its raw text or its time a report cannot be read, and then an older one that can is taken.
        Assert.Equal((AviationWeatherReadKind.Unreadable, (AerodromeMetar?)null),
            Metar("""[{"icaoId": "MDPC", "obsTime": 1794582000}]"""));
        foreach (var unreadable in new[]
                 {
                     """ "rawOb": "  ", "obsTime": 1794582000 """, """ "rawOb": "MDPC 131500Z", "obsTime": "soon" """,
                     """ "rawOb": "MDPC 131500Z", "obsTime": -5 """, """ "rawOb": "MDPC 131500Z", "reportTime": "15:00" """,
                     """ "rawOb": 42, "obsTime": 1794582000 """,
                 })
            Assert.Equal(AviationWeatherReadKind.Unreadable, Metar($$"""[{"icaoId": "MDPC", {{unreadable}}}]""").Kind);
        var older = Metar("""
            [{"icaoId": "MDPC", "obsTime": 1794582000},
             {"icaoId": "MDPC", "rawOb": "MDPC 131400Z 08012KT 9999 FEW020 30/22 Q1016", "obsTime": 1794578400}]
            """);
        Assert.Equal((AviationWeatherReadKind.Report, (DateTimeOffset?)ObservedAt.AddHours(-1)), (older.Kind, older.Report?.ObservedAt));

        // A raw METAR of at most 1 000 characters.
        var longest = new string('X', AviationWeatherParser.MaxMetarLength);
        Assert.Equal(AviationWeatherReadKind.Report,
            Metar($$"""[{"icaoId": "MDPC", "rawOb": "{{longest}}", "obsTime": 1794582000}]""").Kind);
        Assert.Equal(AviationWeatherReadKind.Unreadable,
            Metar($$"""[{"icaoId": "MDPC", "rawOb": "{{longest}}X", "obsTime": 1794582000}]""").Kind);

        // A TAF needs its raw text (at most 4 000 characters), its issue time and a validity that ends after it starts; the
        // latest issue wins.
        const string validity = """ "validTimeFrom": 1794571200, "validTimeTo": 1794657600 """;
        var tafs = Taf($$"""
            [{"icaoId": "MDPC", "rawTAF": "TAF MDPC 131100Z 1312/1412 09012KT", "issueTime": 1794567600, {{validity}}},
             {"icaoId": "MDPC", "rawTAF": "TAF MDPC 131400Z 1312/1412 08010KT", "issueTime": "2026-11-13 14:00:00", {{validity}}},
             {"icaoId": "MDPC", "rawTAF": "TAF MDPC 130500Z 1306/1406 09010KT", "issueTime": 1794546000, {{validity}}}]
            """);
        Assert.Equal((AviationWeatherReadKind.Report, "TAF MDPC 131400Z 1312/1412 08010KT"), (tafs.Kind, tafs.Report?.Raw));
        Assert.Equal((AviationWeatherReadKind.NoReport, (AerodromeTaf?)null), Taf("[]"));
        var tafLongest = new string('X', AviationWeatherParser.MaxTafLength);
        Assert.Equal(AviationWeatherReadKind.Report,
            Taf($$"""[{"icaoId": "MDPC", "rawTAF": "{{tafLongest}}", "issueTime": 1794567600, {{validity}}}]""").Kind);
        foreach (var unreadable in new[]
                 {
                     $$""" "rawTAF": "{{tafLongest}}X", "issueTime": 1794567600, {{validity}} """,
                     $$""" "issueTime": 1794567600, {{validity}} """,
                     $$""" "rawTAF": "TAF MDPC 131100Z", {{validity}} """,
                     """ "rawTAF": "TAF MDPC 131100Z", "issueTime": 1794567600, "validTimeFrom": 1794571200 """,
                     """ "rawTAF": "TAF MDPC 131100Z", "issueTime": 1794567600, "validTimeFrom": 1794571200, "validTimeTo": 1794571200 """,
                 })
            Assert.Equal(AviationWeatherReadKind.Unreadable, Taf($$"""[{"icaoId": "MDPC", {{unreadable}}}]""").Kind);
    }

    [Fact]
    public void KeepsOnlyKnownCategoriesChangesAndCoversWithinTheirLimits()
    {
        var metar = Metar(MetarWith("""
            "fltCat": " mvfr ", "wxString": " -RA BR ", "clouds": [
              {"cover": "few", "base": 1500}, {"cover": "F3W", "base": 1600}, {"cover": "OVERCAST", "base": 1700},
              {"cover": "VV", "base": 200}, "BKN", {"base": 900}, {"cover": "BKN", "base": -100},
              {"cover": "OVC", "base": 100001}, {"cover": "SCT", "base": 2000}, {"cover": "SCT", "base": 3000},
              {"cover": "BKN", "base": 4000}, {"cover": "BKN", "base": 5000}, {"cover": "OVC", "base": 6000}]
            """)).Report;
        Assert.NotNull(metar);
        Assert.Equal(("MVFR", "-RA BR"), (metar.FlightCategory, metar.Weather));
        // The first eight layers that can be read: a bad cover is no layer, a bad base no base.
        Assert.Equal([new AerodromeCloudLayer("FEW", 1500), new AerodromeCloudLayer("VV", 200), new AerodromeCloudLayer("BKN", null),
            new AerodromeCloudLayer("OVC", null), new AerodromeCloudLayer("SCT", 2000), new AerodromeCloudLayer("SCT", 3000),
            new AerodromeCloudLayer("BKN", 4000), new AerodromeCloudLayer("BKN", 5000)], metar.Clouds);
        Assert.Null(Metar(MetarWith(""" "fltCat": "VMC" """)).Report?.FlightCategory);
        Assert.Null(Metar(MetarWith($$""" "wxString": "{{new string('R', AviationWeatherParser.MaxWeatherLength + 1)}}" """)).Report?.Weather);
        Assert.Empty(Metar(MetarWith(""" "clouds": {"cover": "FEW"} """)).Report?.Clouds ?? [new AerodromeCloudLayer("X", 0)]);

        // A period starts with FM, BECMG, TEMPO or PROB; one without its start or its end, or that ends before it starts,
        // is left out, and a TAF keeps its first thirty periods.
        var periods = new StringBuilder();
        periods.Append("""{"timeFrom": 1794571200, "timeTo": 1794574800, "fcstChange": " becmg ", "probability": 40},""");
        periods.Append("""{"timeFrom": 1794571200, "fcstChange": "FM"},""");
        periods.Append("""{"timeTo": 1794574800, "fcstChange": "FM"},""");
        periods.Append("""{"timeFrom": 1794578400, "timeTo": 1794574800, "fcstChange": "FM"},""");
        periods.Append("""{"timeFrom": 1794571200, "timeTo": 1794574800, "fcstChange": "INTER", "probability": 140},""");
        periods.Append(string.Join(',', Enumerable.Range(0, 30).Select(hour =>
            $$"""{"timeFrom": {{1794571200 + hour * 3600}}, "timeTo": {{1794574800 + hour * 3600}}, "fcstChange": "FM"}""")));
        var taf = Taf($$"""
            [{"icaoId": "MDPC", "rawTAF": "TAF MDPC 131100Z 1312/1418", "issueTime": 1794567600,
              "validTimeFrom": 1794571200, "validTimeTo": 1794679200, "fcsts": [{{periods}}]}]
            """).Report;
        Assert.NotNull(taf);
        Assert.Equal(AviationWeatherParser.MaxTafPeriods, taf.Periods.Count);
        Assert.Equal(("BECMG", (int?)40), (taf.Periods[0].Change, taf.Periods[0].ProbabilityPercent));
        Assert.Equal(((string?)null, (int?)null), (taf.Periods[1].Change, taf.Periods[1].ProbabilityPercent));
        Assert.All(taf.Periods.Skip(2), period => Assert.Equal("FM", period.Change));
        // The two that lead and the first 28 of the 30 hourly ones.
        Assert.Equal(TafFrom.AddHours(27), taf.Periods[^1].From);
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
        Assert.NotNull(first.Metar);
        Assert.NotNull(first.Taf);
        Assert.Equal((false, (DateTimeOffset?)Start), (first.MetarKeptAfterFailure, first.RetrievedAt));
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));

        // Within five minutes the service is not asked again.
        clock.Now = Start.AddMinutes(5).AddSeconds(-1);
        var current = await Read(source, cancellationToken);
        Assert.Same(first.Metar, current.Metar);
        Assert.Same(first.Taf, current.Taf);
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));

        // At five minutes only the METAR is asked again; the service fails, and the METAR read before is kept, marked.
        metarAnswer = Answering(HttpStatusCode.InternalServerError);
        tafAnswer = Answering(HttpStatusCode.InternalServerError);
        clock.Now = Start.AddMinutes(5);
        var kept = await Read(source, cancellationToken);
        Assert.Equal((2, 1), (handler.Count("metar"), handler.Count("taf")));
        Assert.Same(first.Metar, kept.Metar);
        Assert.True(kept.MetarKeptAfterFailure);
        Assert.Same(first.Taf, kept.Taf);
        // The last read the service answered.
        Assert.Equal(Start, kept.RetrievedAt);

        // The TAF is asked again at thirty minutes, and kept when that fails.
        clock.Now = Start.AddMinutes(30);
        Assert.Same(first.Taf, (await Read(source, cancellationToken)).Taf);
        Assert.Equal(2, handler.Count("taf"));

        // The METAR is served up to two hours after it was read, then no longer.
        clock.Now = Start.AddHours(2).AddSeconds(-1);
        var lastKept = await Read(source, cancellationToken);
        Assert.Equal((first.Metar, true), (lastKept.Metar, lastKept.MetarKeptAfterFailure));
        clock.Now = Start.AddHours(2);
        var withoutMetar = await Read(source, cancellationToken);
        Assert.Equal(((AerodromeMetar?)null, false), (withoutMetar.Metar, withoutMetar.MetarKeptAfterFailure));
        Assert.Same(first.Taf, withoutMetar.Taf);

        // The TAF up to twelve hours, well within its validity here, then no longer.
        clock.Now = Start.AddHours(12).AddSeconds(-1);
        Assert.Same(first.Taf, (await Read(source, cancellationToken)).Taf);
        clock.Now = Start.AddHours(12);
        var withoutTaf = await Read(source, cancellationToken);
        Assert.Null(withoutTaf.Taf);
        Assert.Equal(Start, withoutTaf.RetrievedAt);

        // Once the service answers again, both are current and nothing is marked.
        metarAnswer = Answering(Fixture(MetarFixture));
        tafAnswer = Answering(Fixture(TafFixture));
        clock.Advance(TimeSpan.FromMinutes(15));
        var back = await Read(source, cancellationToken);
        Assert.NotNull(back.Metar);
        Assert.NotNull(back.Taf);
        Assert.Equal((false, (DateTimeOffset?)clock.Now), (back.MetarKeptAfterFailure, back.RetrievedAt));
    }

    [Fact]
    public async Task ATafIsNeverServedPastItsValidity()
    {
        var clock = new ManualClock(Start);
        var tafAnswer = Answering(TafValidUntil(Start.AddHours(3)));
        var handler = new StubHandler(request => IsMetar(request) ? Json(Fixture(MetarFixture)) : tafAnswer());
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;
        var first = await Read(source, cancellationToken);
        Assert.NotNull(first.Taf);

        // Kept after failures, but only until its validity ends, long before twelve hours.
        tafAnswer = Answering(HttpStatusCode.ServiceUnavailable);
        clock.Now = Start.AddHours(3).AddSeconds(-1);
        Assert.Same(first.Taf, (await Read(source, cancellationToken)).Taf);
        clock.Now = Start.AddHours(3);
        Assert.Null((await Read(source, cancellationToken)).Taf);

        // Nor is a TAF the service answers after its validity ended.
        tafAnswer = Answering(TafValidUntil(Start.AddHours(3)));
        clock.Advance(TimeSpan.FromMinutes(20));
        var asked = handler.Count("taf");
        Assert.Null((await Read(source, cancellationToken)).Taf);
        Assert.Equal(asked + 1, handler.Count("taf"));
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("204")]
    [InlineData("another airport")]
    public async Task AnEmptyAnswerMeansNoReport(string answer)
    {
        var clock = new ManualClock(Start);
        var empty = answer switch
        {
            "204" => Answering(HttpStatusCode.NoContent),
            "another airport" => Answering("""
                [{"icaoId": "MDSD", "rawOb": "MDSD 131500Z 10010KT 9999 FEW020 30/21 Q1014", "obsTime": 1794582000}]
                """),
            _ => Answering(answer),
        };
        var metarAnswer = Answering(Fixture(MetarFixture));
        var tafAnswer = Answering(Fixture(TafFixture));
        var handler = new StubHandler(request => IsMetar(request) ? metarAnswer() : tafAnswer());
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;
        Assert.NotNull((await Read(source, cancellationToken)).Metar);

        // At thirty minutes both are asked again and the service has neither: what was kept is dropped, and it is no failure.
        metarAnswer = empty;
        tafAnswer = empty;
        clock.Now = Start.AddMinutes(30);
        var none = await Read(source, cancellationToken);
        Assert.Equal(((AerodromeMetar?)null, false, (AerodromeTaf?)null, (DateTimeOffset?)clock.Now),
            (none.Metar, none.MetarKeptAfterFailure, none.Taf, none.RetrievedAt));
        Assert.Equal((2, 2), (handler.Count("metar"), handler.Count("taf")));

        // The absence is kept like a report: nothing is asked within five minutes (a failure would be asked after one).
        clock.Advance(TimeSpan.FromMinutes(1));
        await Read(source, cancellationToken);
        Assert.Equal(2, handler.Count("metar"));
        clock.Advance(TimeSpan.FromMinutes(4));
        Assert.Null((await Read(source, cancellationToken)).Metar);
        Assert.Equal(3, handler.Count("metar"));

        // No failure was counted: the first one after the empty answers waits a minute, not more.
        metarAnswer = Answering(HttpStatusCode.ServiceUnavailable);
        clock.Advance(TimeSpan.FromMinutes(5));
        await Read(source, cancellationToken);
        clock.Advance(TimeSpan.FromMinutes(1));
        await Read(source, cancellationToken);
        Assert.Equal(5, handler.Count("metar"));
    }

    [Fact]
    public async Task NeverRetriesInALoopWhileBackingOff()
    {
        var clock = new ManualClock(Start);
        var metarAnswer = Answering(Fixture(MetarFixture));
        var handler = new StubHandler(request => IsMetar(request) ? metarAnswer() : Json(Fixture(TafFixture)));
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;
        var first = await Read(source, cancellationToken);

        // From five minutes on every METAR read fails. Reading every fifteen seconds for an hour, a read sends at most one
        // request, and the service is asked again only after 1, 2, 4, 8 and then every 15 minutes; meanwhile the METAR read
        // before is served.
        metarAnswer = Answering(HttpStatusCode.BadGateway);
        var failingSince = Start.AddMinutes(5);
        clock.Now = failingSince;
        var asked = new List<int>();
        for (var reads = 0; reads <= 4 * 60; reads++)
        {
            var before = handler.Count("metar");
            var weather = await Read(source, cancellationToken);
            Assert.Equal((first.Metar, true), (weather.Metar, weather.MetarKeptAfterFailure));
            var sent = handler.Count("metar") - before;
            Assert.InRange(sent, 0, 1);
            if (sent == 1) asked.Add((int)(clock.Now - failingSince).TotalMinutes);
            clock.Advance(TimeSpan.FromSeconds(15));
        }
        Assert.Equal([0, 1, 3, 7, 15, 30, 45, 60], asked);

        // A 429 waits what its Retry-After asks when that is longer: thirty minutes instead of fifteen.
        metarAnswer = () => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
            { Headers = { RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromMinutes(30)) } };
        clock.Now = failingSince.AddMinutes(75);
        await Read(source, cancellationToken);
        var limited = handler.Count("metar");
        clock.Now = failingSince.AddMinutes(105).AddSeconds(-1);
        await Read(source, cancellationToken);
        Assert.Equal(limited, handler.Count("metar"));
        clock.Now = failingSince.AddMinutes(105);
        await Read(source, cancellationToken);
        Assert.Equal(limited + 1, handler.Count("metar"));
    }

    [Theory]
    [InlineData("a delay of thirty minutes", 30)]
    [InlineData("a date thirty minutes ahead", 30)]
    [InlineData("a date thirty minutes past", 1)]
    public async Task TooManyRequestsWaitsTheDelayOrTheDateOfItsRetryAfter(string retryAfter, int waitMinutes)
    {
        // Every request gets a 429. A first failure waits a minute; a Retry-After that asks for longer, as a delay or as a
        // date counted from the source's clock, is waited instead, and a date already past asks for nothing.
        var clock = new ManualClock(Start);
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.TooManyRequests)
        {
            Headers =
            {
                RetryAfter = retryAfter switch
                {
                    "a delay of thirty minutes" => new RetryConditionHeaderValue(TimeSpan.FromMinutes(30)),
                    "a date thirty minutes ahead" => new RetryConditionHeaderValue(clock.Now.AddMinutes(30)),
                    "a date thirty minutes past" => new RetryConditionHeaderValue(clock.Now.AddMinutes(-30)),
                    _ => throw new ArgumentOutOfRangeException(nameof(retryAfter), retryAfter, null),
                },
            },
        });
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;

        await Read(source, cancellationToken);
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));

        // Neither report is asked again a second before its wait ends, and both are once it has.
        clock.Now = Start.AddMinutes(waitMinutes).AddSeconds(-1);
        await Read(source, cancellationToken);
        Assert.Equal((1, 1), (handler.Count("metar"), handler.Count("taf")));
        clock.Now = Start.AddMinutes(waitMinutes);
        await Read(source, cancellationToken);
        Assert.Equal((2, 2), (handler.Count("metar"), handler.Count("taf")));
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

        // The first caller starts both reads; the two that come while they are on their way wait for them.
        var first = source.ReadAsync("MDPC", leaving.Token);
        await bothSent.Task.WaitAsync(TimeSpan.FromSeconds(10), cancellationToken);
        var second = source.ReadAsync("mdpc", cancellationToken);
        var third = source.ReadAsync(" MDPC ", cancellationToken);

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
            Assert.NotNull(answer.Metar);
            Assert.NotNull(answer.Taf);
        });
        Assert.Same(answers[0]?.Metar, answers[1]?.Metar);
    }

    [Theory]
    [InlineData("https://aviationweather.gov/api/data/", "https://aviationweather.gov/api/data/")]
    [InlineData("https://weather.example/mirror/api/data", "https://weather.example/mirror/api/data/")]
    public async Task BuildsBothQueriesFromTheBaseUrl(string baseUrl, string expected)
    {
        var handler = new StubHandler(_ => Json("[]"));
        using var source = new AviationWeatherSource(new HttpClient(handler), new Uri(baseUrl), new ManualClock(Start));

        await source.ReadAsync(" mdpc ", TestContext.Current.CancellationToken);

        // The ICAO code in upper case, the two queries side by side, both GET.
        Assert.Equal(expected, source.BaseUrl.AbsoluteUri);
        Assert.Equal([$"{expected}metar?ids=MDPC&format=json", $"{expected}taf?ids=MDPC&format=json"],
            handler.Requests.Select(request => request.Uri).Order(StringComparer.Ordinal));
        Assert.All(handler.Requests, request => Assert.Equal(HttpMethod.Get, request.Method));
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData("PUJ", "PUJ")]
    [InlineData("mdpcx", "MDPCX")]
    [InlineData("MD1C", "MD1C")]
    [InlineData("MD C", "MD C")]
    [InlineData("MDPÇ", "MDPÇ")]
    public async Task AnIcaoThatIsNotFourLettersIsNeverSent(string? icao, string echoed)
    {
        var handler = new StubHandler(_ => Json(Fixture(MetarFixture)));
        using var source = Source(handler);

        var weather = await source.ReadAsync(icao!, TestContext.Current.CancellationToken);

        Assert.NotNull(weather);
        Assert.Equal((echoed, (AerodromeMetar?)null, false, (AerodromeTaf?)null, (DateTimeOffset?)null),
            (weather.IcaoCode, weather.Metar, weather.MetarKeptAfterFailure, weather.Taf, weather.RetrievedAt));
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task SendsAGenericUserAgentAndAsksForJson()
    {
        var handler = new StubHandler(_ => Json("[]"));
        using var source = Source(handler);

        await source.ReadAsync("MDPC", TestContext.Current.CancellationToken);

        // The same generic product name the traffic networks see.
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(handler.Requests, request =>
        {
            Assert.Equal((ReadsbAirTrafficProvider.UserAgent, "application/json"), (request.UserAgent, request.Accept));
            foreach (var revealing in Revealing)
                Assert.DoesNotContain(revealing, request.UserAgent, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public void TheClientFollowsNoRedirectAcceptsCompressedAnswersAndGivesUpAfterTenSeconds()
    {
        using var handler = AviationWeatherSource.CreateHandler();
        Assert.False(handler.AllowAutoRedirect);
        Assert.Equal(DecompressionMethods.All, handler.AutomaticDecompression);

        using var client = AviationWeatherSource.CreateHttpClient();
        Assert.Equal(TimeSpan.FromSeconds(10), client.Timeout);
        Assert.Equal(1024 * 1024, AviationWeatherSource.MaxAnswerBytes);
        Assert.Equal(AviationWeatherSource.MaxAnswerBytes, client.MaxResponseContentBufferSize);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("")]
    [InlineData("{}")]
    [InlineData("\"MDPC\"")]
    [InlineData("""[{"icaoId": "MDPC"}]""")]
    [InlineData("timeout")]
    [InlineData("connection refused")]
    [InlineData("too many requests")]
    [InlineData("server error")]
    [InlineData("unavailable")]
    [InlineData("bad request")]
    [InlineData("not found")]
    [InlineData("redirect")]
    public async Task BadJsonATimeoutOrAServerErrorIsAFailure(string answer)
    {
        var clock = new ManualClock(Start);
        var handler = new StubHandler(_ => answer switch
        {
            // What HttpClient throws when its own limit runs out.
            "timeout" => throw new TaskCanceledException("The request was canceled.", new TimeoutException()),
            "connection refused" => throw new HttpRequestException("Connection refused."),
            "too many requests" => new HttpResponseMessage(HttpStatusCode.TooManyRequests),
            "server error" => new HttpResponseMessage(HttpStatusCode.InternalServerError),
            "unavailable" => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable),
            "bad request" => new HttpResponseMessage(HttpStatusCode.BadRequest),
            "not found" => new HttpResponseMessage(HttpStatusCode.NotFound),
            // A redirect is never followed.
            "redirect" => new HttpResponseMessage(HttpStatusCode.Found)
                { Headers = { Location = new Uri("https://mirror.example/api/data/metar?ids=MDPC&format=json") } },
            _ => Json(answer),
        });
        using var source = Source(handler, clock);
        var cancellationToken = TestContext.Current.CancellationToken;

        var weather = await Read(source, cancellationToken);

        Assert.Equal(((AerodromeMetar?)null, false, (AerodromeTaf?)null, (DateTimeOffset?)null),
            (weather.Metar, weather.MetarKeptAfterFailure, weather.Taf, weather.RetrievedAt));
        Assert.Equal(2, handler.Requests.Count);
        // A failure: the service is asked again only after its wait, a minute after the first one.
        await Read(source, cancellationToken);
        clock.Advance(TimeSpan.FromSeconds(59));
        await Read(source, cancellationToken);
        Assert.Equal(2, handler.Requests.Count);
        clock.Advance(TimeSpan.FromSeconds(1));
        await Read(source, cancellationToken);
        Assert.Equal(4, handler.Requests.Count);
    }

    [Fact]
    public async Task TheCallersCancellationIsThrown()
    {
        var handler = new StubHandler(_ => Json(Fixture(MetarFixture)));
        using var source = Source(handler);
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => source.ReadAsync("MDPC", cancellation.Token));
        // A caller that has already given up sends nothing.
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public void TheCreditIsTheAviationWeatherCenter() =>
        Assert.Equal(new AerodromeWeatherAttribution("NOAA Aviation Weather Center", "https://aviationweather.gov"),
            AerodromeWeatherAttribution.NoaaAviationWeatherCenter);

    private static void AssertPeriod(AerodromeTafPeriod expected, AerodromeTafPeriod actual, params AerodromeCloudLayer[] clouds)
    {
        Assert.Equal(expected with { Clouds = actual.Clouds }, actual);
        Assert.Equal(clouds, actual.Clouds);
    }

    private static void AssertClose(double? expected, double? actual)
    {
        if (expected is not { } value)
        {
            Assert.Null(actual);
            return;
        }
        Assert.NotNull(actual);
        Assert.Equal(value, actual.Value, 6);
    }

    private static (AviationWeatherReadKind Kind, AerodromeMetar? Report) Metar(string json)
    {
        using var document = JsonDocument.Parse(json);
        return AviationWeatherParser.ParseMetar(document.RootElement, "MDPC");
    }

    private static (AviationWeatherReadKind Kind, AerodromeTaf? Report) Taf(string json)
    {
        using var document = JsonDocument.Parse(json);
        return AviationWeatherParser.ParseTaf(document.RootElement, "MDPC");
    }

    /// <summary>A list with one readable METAR of MDPC that carries <paramref name="fields"/> as well.</summary>
    private static string MetarWith(string fields) =>
        $$"""[{"icaoId": "MDPC", "rawOb": "MDPC 131500Z AUTO", "obsTime": 1794582000, {{fields}}}]""";

    /// <summary>A TAF of MDPC issued at 14:30 and valid from 14:05 to <paramref name="validTo"/>.</summary>
    private static string TafValidUntil(DateTimeOffset validTo) => $$"""
        [{"icaoId": "MDPC", "rawTAF": "TAF MDPC 131430Z 1314/1318 09012KT 9999 FEW020", "issueTime": "2026-11-13T14:30:00Z",
          "validTimeFrom": {{Start.AddHours(-1).ToUnixTimeSeconds()}}, "validTimeTo": {{validTo.ToUnixTimeSeconds()}}, "fcsts": []}]
        """;

    private static async Task<AerodromeWeatherData> Read(AviationWeatherSource source, CancellationToken cancellationToken) =>
        await source.ReadAsync("MDPC", cancellationToken) ?? throw new InvalidOperationException("The source is disabled.");

    private static AviationWeatherSource Source(StubHandler handler, TimeProvider? clock = null) =>
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
            Requests.Enqueue(new SentRequest(request.Method, uri.AbsoluteUri, uri.AbsolutePath[(uri.AbsolutePath.LastIndexOf('/') + 1)..],
                request.Headers.UserAgent.ToString(), request.Headers.Accept.ToString()));
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
