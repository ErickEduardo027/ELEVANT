using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.Weather;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0043 (contracts 1.4): the weather of a station's airport is read by the same readers as the OCC map (AVIAM internal
/// staff with the station in scope and any of the four map permissions), for any station in scope, by its airport's ICAO
/// code. Its state comes in the success: Disabled without a weather service, Unavailable without a METAR, Stale for a METAR
/// older than 90 minutes or kept after a failure, Live otherwise; the credit always comes. The airports, the actor and the
/// weather source are stubs with invented reports: nothing reaches a database or the network.
/// </summary>
public sealed class OccAerodromeWeatherHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 30, 0, TimeSpan.Zero);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000045");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SantoDomingo = Guid.Parse("20000000-0000-7000-8000-000000000004");
    private static readonly Guid Elsewhere = Guid.Parse("20000000-0000-7000-8000-000000000099");
    private static readonly AerodromeWeatherAttribution Credit = new("NOAA Aviation Weather Center", "https://aviationweather.gov");

    private static readonly string[] MapPermissions =
    [
        "operations.dashboard.read", "operations.flight_monitoring.read", "operations.positions_map.read",
        "operations.planning.read",
    ];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task AuthorizesAnyMapReaderWithTheStationInScope()
    {
        var airports = new Airports();
        var weather = new Weather(icao => Report(icao, Metar(Now.AddMinutes(-30)), taf: Taf()));

        // Each of the four map permissions reads the weather of the station's airport: Punta Cana reads MDPC.
        foreach (var permission in MapPermissions)
        {
            var read = await Handler(Member(permission), airports, weather).HandleAsync(AccountId, PuntaCana, Ct);
            Assert.True(read.IsSuccess, permission);
            var data = read.Value!;
            Assert.Equal((PuntaCana, "MDPC", AerodromeWeatherStatus.Live, Now, (DateTimeOffset?)Now.AddMinutes(-2)),
                (data.StationId, data.IcaoCode, data.Status, data.ServerTime, data.RetrievedAt));
            Assert.Equal(Credit, data.Source);
            Assert.NotNull(data.Metar);
            Assert.NotNull(data.Taf);
            Assert.Equal("MDPC", weather.Requests[^1]);
        }
        Assert.Equal(Enumerable.Repeat(PuntaCana, MapPermissions.Length), airports.Requests);

        // Any station in scope has its weather, not only the one with live traffic: Santo Domingo reads its own airport.
        var sdq = await Handler(Member("operations.planning.read"), airports, weather).HandleAsync(AccountId, SantoDomingo, Ct);
        Assert.True(sdq.IsSuccess);
        Assert.Equal(("MDSD", "MDSD"), (sdq.Value!.IcaoCode, weather.Requests[^1]));
        Assert.Equal(MapPermissions.Length + 1, weather.Requests.Count);
    }

    [Fact]
    public async Task RefusesAnyoneOutsideTheInternalStaffOrWithoutAMapPermission()
    {
        var airports = new Airports();
        var weather = new Weather(icao => Report(icao, Metar(Now.AddMinutes(-30))));
        var planner = Member("operations.planning.read");
        var airline = Member(MapPermissions) with
        {
            Memberships = [planner.Memberships[0] with { OrganizationType = OrganizationType.AirlineCustomer,
                Kind = MembershipKind.AirlineClient }],
        };

        // Another permission of Operations alone, no permission at all, or the map permissions outside AVIAM's staff.
        foreach (var refused in new[] { Member("operations.review.read"), Member(), airline })
            Assert.Equal(OccMapFailure.Forbidden,
                (await Handler(refused, airports, weather).HandleAsync(AccountId, PuntaCana, Ct)).Failure);

        // A session whose account no longer resolves, or that belongs to someone else, and no account at all.
        Assert.Equal(OccMapFailure.Unauthorized,
            (await Handler(null, airports, weather).HandleAsync(AccountId, PuntaCana, Ct)).Failure);
        Assert.Equal(OccMapFailure.Unauthorized, (await Handler(planner with { AccountId = Guid.NewGuid() }, airports, weather)
            .HandleAsync(AccountId, PuntaCana, Ct)).Failure);
        Assert.Equal(OccMapFailure.Unauthorized,
            (await Handler(planner, airports, weather).HandleAsync(Guid.Empty, PuntaCana, Ct)).Failure);

        // None of them reached the airports or the weather service.
        Assert.Equal((0, 0), (airports.Requests.Count, weather.Requests.Count));
    }

    [Fact]
    public async Task AnotherStationOrAnUnknownAirportIsNotFound()
    {
        var airports = new Airports();
        var weather = new Weather(icao => Report(icao, Metar(Now.AddMinutes(-30))));
        var reader = Member(MapPermissions);

        // A station outside the reader's scope: not found, before the airports are asked.
        Assert.Equal(OccMapFailure.NotFound,
            (await Handler(reader, airports, weather).HandleAsync(AccountId, Elsewhere, Ct)).Failure);
        Assert.Empty(airports.Requests);

        // A station of the scope the store does not know (unknown or inactive), or whose airport has no four-letter ICAO
        // code: not found, and the weather service is never asked.
        foreach (var icao in new string?[] { null, "", "MDP", "MDPCX", "MD1C", "mdpc", " MDPC" })
        {
            airports.Codes[PuntaCana] = icao;
            Assert.Equal(OccMapFailure.NotFound,
                (await Handler(reader, airports, weather).HandleAsync(AccountId, PuntaCana, Ct)).Failure);
        }
        Assert.Equal(7, airports.Requests.Count);
        Assert.Empty(weather.Requests);
    }

    [Fact]
    public async Task AnEmptyStationIsInvalidBeforeAnyRead()
    {
        var resolver = new Resolver(Member(MapPermissions));
        var airports = new Airports();
        var weather = new Weather(icao => Report(icao, Metar(Now.AddMinutes(-30))));
        var handler = new GetOccAerodromeWeatherHandler(resolver, airports, weather, new FixedClock(Now));

        Assert.Equal(OccMapFailure.InvalidRequest, (await handler.HandleAsync(AccountId, Guid.Empty, Ct)).Failure);

        // Neither the actor, nor the airports, nor the weather service were asked.
        Assert.Equal((0, 0, 0), (resolver.Calls, airports.Requests.Count, weather.Requests.Count));
    }

    [Fact]
    public async Task AnswersDisabledWithoutASource()
    {
        var airports = new Airports();
        var reader = Member("operations.dashboard.read");

        // The source of every host without AviationWeather (tools, tests, an API with it off) answers no weather at all.
        var read = await new GetOccAerodromeWeatherHandler(new Resolver(reader), airports,
            new DisabledAerodromeWeatherSource(), new FixedClock(Now)).HandleAsync(AccountId, PuntaCana, Ct);

        Assert.True(read.IsSuccess);
        Assert.Equal(new OccAerodromeWeatherData(PuntaCana, "MDPC", AerodromeWeatherStatus.Disabled, Now, null, Credit, null,
            null), read.Value);
        Assert.Same(AerodromeWeatherAttribution.NoaaAviationWeatherCenter, read.Value!.Source);

        // The same with a stub that answers null: no report, no retrieval time, and the credit still comes.
        var stub = new Weather(_ => null);
        var stubRead = await Handler(reader, airports, stub).HandleAsync(AccountId, PuntaCana, Ct);
        Assert.Equal((AerodromeWeatherStatus.Disabled, (DateTimeOffset?)null, (AerodromeMetar?)null, (AerodromeTaf?)null, Credit),
            (stubRead.Value!.Status, stubRead.Value.RetrievedAt, stubRead.Value.Metar, stubRead.Value.Taf, stubRead.Value.Source));
        Assert.Equal(["MDPC"], stub.Requests);
    }

    [Fact]
    public async Task IsLiveUpToNinetyMinutesAndStaleAfter()
    {
        var airports = new Airports();
        var reader = Member(MapPermissions);

        // With a fixed clock: 89 and 90 minutes old are live, 91 is stale; a report a little ahead of the clock is live.
        foreach (var (minutes, expected) in new[]
                 {
                     (89, AerodromeWeatherStatus.Live), (90, AerodromeWeatherStatus.Live),
                     (91, AerodromeWeatherStatus.Stale), (-5, AerodromeWeatherStatus.Live),
                     (600, AerodromeWeatherStatus.Stale),
                 })
        {
            var metar = Metar(Now.AddMinutes(-minutes));
            var read = await Handler(reader, airports, new Weather(icao => Report(icao, metar)))
                .HandleAsync(AccountId, PuntaCana, Ct);
            Assert.Equal((expected, metar), (read.Value!.Status, read.Value.Metar));
        }

        // The rule itself, pure: a second over the 90 minutes is stale.
        Assert.Equal(TimeSpan.FromMinutes(90), AerodromeWeatherStatus.LiveMetarAge);
        Assert.Equal(AerodromeWeatherStatus.Live, AerodromeWeatherStatus.Of(Report("MDPC", Metar(Now.AddMinutes(-90))), Now));
        Assert.Equal(AerodromeWeatherStatus.Stale,
            AerodromeWeatherStatus.Of(Report("MDPC", Metar(Now.AddMinutes(-90).AddSeconds(-1))), Now));
        Assert.Equal(AerodromeWeatherStatus.Disabled, AerodromeWeatherStatus.Of(null, Now));
        Assert.Equal(AerodromeWeatherStatus.Unavailable, AerodromeWeatherStatus.Of(Report("MDPC", null), Now));
    }

    [Fact]
    public async Task AMetarKeptAfterAFailureIsStale()
    {
        var airports = new Airports();
        var metar = Metar(Now.AddMinutes(-10));

        // A fresh METAR the source kept because the last refresh failed: stale, with the report and its retrieval time.
        var read = await Handler(Member(MapPermissions), airports,
                new Weather(icao => Report(icao, metar, keptAfterFailure: true, taf: Taf(), retrievedAt: Now.AddMinutes(-40))))
            .HandleAsync(AccountId, PuntaCana, Ct);

        Assert.True(read.IsSuccess);
        Assert.Equal((AerodromeWeatherStatus.Stale, metar, (DateTimeOffset?)Now.AddMinutes(-40)),
            (read.Value!.Status, read.Value.Metar, read.Value.RetrievedAt));
        Assert.NotNull(read.Value.Taf);
        Assert.Equal(AerodromeWeatherStatus.Stale,
            AerodromeWeatherStatus.Of(Report("MDPC", metar, keptAfterFailure: true), Now));
    }

    [Fact]
    public async Task WithoutAMetarItIsUnavailableAndKeepsTheTaf()
    {
        var airports = new Airports();
        var reader = Member(MapPermissions);
        var taf = Taf();

        // The service has no METAR (or none the source may still serve), but a TAF: unavailable, with the TAF.
        var read = await Handler(reader, airports, new Weather(icao => Report(icao, null, taf: taf)))
            .HandleAsync(AccountId, PuntaCana, Ct);
        Assert.Equal((AerodromeWeatherStatus.Unavailable, (AerodromeMetar?)null, taf, (DateTimeOffset?)Now.AddMinutes(-2)),
            (read.Value!.Status, read.Value.Metar, read.Value.Taf, read.Value.RetrievedAt));

        // Never answered (every read failed so far): unavailable, without a report and without a retrieval time.
        var never = await Handler(reader, airports, new Weather(icao => new AerodromeWeatherData(icao, null, false, null, null)))
            .HandleAsync(AccountId, PuntaCana, Ct);
        Assert.Equal(new OccAerodromeWeatherData(PuntaCana, "MDPC", AerodromeWeatherStatus.Unavailable, Now, null, Credit, null,
            null), never.Value);
    }

    [Fact]
    public async Task AFaultOfTheSourceIsUnavailableAndOnlyTheCallersCancellationIsThrown()
    {
        var airports = new Airports();
        var reader = Member(MapPermissions);

        // A source that throws (a fault of its own code, not of the service) still answers the weather: unavailable.
        foreach (var fault in new Exception[]
                 {
                     new InvalidOperationException("synthetic fault"), new HttpRequestException("synthetic"),
                     new OperationCanceledException("a timeout of its own"),
                 })
        {
            var read = await Handler(reader, airports, new Weather(_ => throw fault)).HandleAsync(AccountId, PuntaCana, Ct);
            Assert.Equal(new OccAerodromeWeatherData(PuntaCana, "MDPC", AerodromeWeatherStatus.Unavailable, Now, null, Credit,
                null, null), read.Value);
        }

        // The caller giving up is not a state of the weather: it is thrown.
        using var cancelled = new CancellationTokenSource();
        var weather = new Weather(_ =>
        {
            cancelled.Cancel();
            cancelled.Token.ThrowIfCancellationRequested();
            return null;
        });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Handler(reader, airports, weather).HandleAsync(AccountId, PuntaCana, cancelled.Token));
    }

    private static GetOccAerodromeWeatherHandler Handler(ActorContext? actor, Airports airports, IAerodromeWeatherSource weather) =>
        new(new Resolver(actor), airports, weather, new FixedClock(Now));

    /// <summary>What a weather source answers for <paramref name="icao"/>: read two minutes before the clock unless said.</summary>
    private static AerodromeWeatherData Report(string icao, AerodromeMetar? metar, bool keptAfterFailure = false,
        AerodromeTaf? taf = null, DateTimeOffset? retrievedAt = null) =>
        new(icao, metar, keptAfterFailure, taf, retrievedAt ?? Now.AddMinutes(-2));

    /// <summary>An invented METAR of Punta Cana observed at <paramref name="observedAt"/>.</summary>
    private static AerodromeMetar Metar(DateTimeOffset observedAt) => new("MDPC 131500Z 09014KT 9999 FEW018 29/22 Q1015",
        observedAt, "VFR", 90, false, 14, null, 6, 29, 22, 1015, null, [new AerodromeCloudLayer("FEW", 1800)]);

    /// <summary>An invented TAF of Punta Cana with two periods.</summary>
    private static AerodromeTaf Taf()
    {
        var from = new DateTimeOffset(2026, 11, 13, 12, 0, 0, TimeSpan.Zero);
        return new AerodromeTaf("TAF MDPC 131100Z 1312/1412 09012KT 9999 FEW020 TEMPO 1316/1320 4000 SHRA",
            from.AddHours(-1), from, from.AddHours(24),
            [
                new AerodromeTafPeriod(from, from.AddHours(24), null, null, 90, false, 12, null, 6, null,
                    [new AerodromeCloudLayer("FEW", 2000)]),
                new AerodromeTafPeriod(from.AddHours(4), from.AddHours(8), "TEMPO", null, null, false, null, null, 2.49,
                    "SHRA", []),
            ]);
    }

    /// <summary>AVIAM internal staff of Operations with the given permissions, Punta Cana and Santo Domingo in scope.</summary>
    private static ActorContext Member(params string[] permissions) => new(AccountId, "occ.weather@example.test",
        "OCC Weather Reader",
        [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000001"), "ADMIN_OCC", "Admin OCC", PortalKind.BackOffice,
            "admin_occ")],
        [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000001"),
            Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development", OrganizationType.AviamOperator,
            MembershipKind.InternalStaff)],
        [new ActorStationScope(PuntaCana, "PUJ"), new ActorStationScope(SantoDomingo, "SDQ")],
        new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Operations,
            permissions.ToHashSet(StringComparer.Ordinal)));

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public int Calls { get; private set; }

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(actor);
        }
    }

    /// <summary>The airports' ICAO codes by station (Punta Cana MDPC, Santo Domingo MDSD), and every station asked about.</summary>
    private sealed class Airports : IOccStationAirportStore
    {
        public Dictionary<Guid, string?> Codes { get; } = new() { [PuntaCana] = "MDPC", [SantoDomingo] = "MDSD" };

        public List<Guid> Requests { get; } = [];

        public Task<string?> FindIcaoCodeAsync(Guid stationId, CancellationToken cancellationToken = default)
        {
            Requests.Add(stationId);
            return Task.FromResult(Codes.GetValueOrDefault(stationId));
        }
    }

    /// <summary>A weather source that answers what <paramref name="answer"/> says, and records every ICAO code asked for.</summary>
    private sealed class Weather(Func<string, AerodromeWeatherData?> answer) : IAerodromeWeatherSource
    {
        public List<string> Requests { get; } = [];

        public Task<AerodromeWeatherData?> ReadAsync(string icaoCode, CancellationToken cancellationToken = default)
        {
            Requests.Add(icaoCode);
            return Task.FromResult(answer(icaoCode));
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
