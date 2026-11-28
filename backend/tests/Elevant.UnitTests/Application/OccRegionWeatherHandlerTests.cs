using System.Collections.ObjectModel;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.Weather;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// Plan M6: the weather of the region around a station's airport is read by the same readers as the OCC map (AVIAM internal
/// staff with the station in scope and any of the four map permissions). Only Punta Cana has a region, its 32 airports in
/// the order the maps draw them; any other station is not found. The state follows the METARs and comes in the success
/// with its reason, when to ask again and the credit. The airports, the actor and the weather source are stubs with
/// invented reports: nothing reaches a database or the network.
/// </summary>
public sealed class OccRegionWeatherHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 30, 0, TimeSpan.Zero);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000047");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SantoDomingo = Guid.Parse("20000000-0000-7000-8000-000000000004");
    private static readonly Guid Elsewhere = Guid.Parse("20000000-0000-7000-8000-000000000099");
    private static readonly AerodromeWeatherAttribution Credit = new("NOAA Aviation Weather Center", "https://aviationweather.gov");
    private static readonly string[] RegionCodes = [.. RegionWeatherStations.AroundPuntaCana.Select(station => station.IcaoCode)];

    private static readonly string[] MapPermissions =
    [
        "operations.dashboard.read", "operations.flight_monitoring.read", "operations.positions_map.read",
        "operations.planning.read",
    ];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task EveryMapReaderReadsTheThirtyTwoAirportsOfPuntaCana()
    {
        var airports = new Airports();
        var weather = new Weather(_ => Data(Metars(("MDPC", Metar("MDPC", Now.AddMinutes(-30)))),
            tafs: Tafs(("MDPC", Taf("MDPC")), ("MDSD", Taf("MDSD")))));

        foreach (var permission in MapPermissions)
        {
            var read = await Handler(Member(permission), airports, weather).HandleAsync(AccountId, PuntaCana, Ct);
            Assert.True(read.IsSuccess, permission);
            var data = read.Value!;
            Assert.Equal((PuntaCana, AerodromeWeatherStatus.Live, (string?)null, Now, 300),
                (data.StationId, data.Status, data.Reason, data.ServerTime, data.RefreshAfterSeconds));
            Assert.Equal(Credit, data.Credit);

            // Every airport of the region, in the order of the catalogue, with or without its reports; the source was
            // asked for all of them at once.
            Assert.Equal(RegionWeatherStations.AroundPuntaCana, data.Stations.Select(station => station.Station));
            Assert.Equal(RegionCodes, weather.Requests[^1]);
            Assert.Equal(("MDPC", "PUJ"), (data.Stations[0].Station.IcaoCode, data.Stations[0].Station.IataCode));
            Assert.NotNull(data.Stations[0].Metar);
            Assert.Equal(8000, data.Stations[0].CeilingFeet);
            Assert.NotNull(data.Stations[0].Taf);
            var sdq = Assert.Single(data.Stations, station => station.Station.IcaoCode == "MDSD");
            Assert.Equal(((AerodromeMetar?)null, (int?)null), (sdq.Metar, sdq.CeilingFeet));
            Assert.NotNull(sdq.Taf);
            Assert.All(data.Stations.Where(station => station.Station.IcaoCode is not ("MDPC" or "MDSD")), station =>
                Assert.Equal(((AerodromeMetar?)null, (int?)null, (AerodromeTaf?)null), (station.Metar, station.CeilingFeet,
                    station.Taf)));
        }
        Assert.Equal(Enumerable.Repeat(PuntaCana, MapPermissions.Length), airports.Requests);
        Assert.Equal(MapPermissions.Length, weather.Requests.Count);
    }

    [Fact]
    public async Task RefusesAnyoneOutsideTheInternalStaffOrWithoutAMapPermission()
    {
        var airports = new Airports();
        var weather = new Weather(_ => Data(Metars(("MDPC", Metar("MDPC", Now.AddMinutes(-30))))));
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
    public async Task AStationWithoutARegionIsNotFound()
    {
        var airports = new Airports();
        var weather = new Weather(_ => Data(Metars(("MDPC", Metar("MDPC", Now.AddMinutes(-30))))));
        var reader = Member(MapPermissions);

        // A station outside the reader's scope: not found, before the airports are asked.
        Assert.Equal(OccMapFailure.NotFound,
            (await Handler(reader, airports, weather).HandleAsync(AccountId, Elsewhere, Ct)).Failure);
        Assert.Empty(airports.Requests);

        // Santo Domingo is in scope and has its airport's weather, but no region of its own.
        Assert.Equal(OccMapFailure.NotFound,
            (await Handler(reader, airports, weather).HandleAsync(AccountId, SantoDomingo, Ct)).Failure);

        // A station the store does not know (unknown or inactive), or an airport that is not Punta Cana as the store writes it.
        foreach (var icao in new string?[] { null, "", "MDP", "mdpc", " MDPC", "MDPCX" })
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
        var weather = new Weather(_ => Data(Metars()));
        var handler = new GetOccRegionWeatherHandler(resolver, airports, weather, new FixedClock(Now));

        Assert.Equal(OccMapFailure.InvalidRequest, (await handler.HandleAsync(AccountId, Guid.Empty, Ct)).Failure);

        // Neither the actor, nor the airports, nor the weather service were asked.
        Assert.Equal((0, 0, 0), (resolver.Calls, airports.Requests.Count, weather.Requests.Count));
    }

    [Fact]
    public async Task AnswersDisabledWithoutASource()
    {
        var reader = Member("operations.dashboard.read");

        // The source of every host without AviationWeather (tools, tests, an API with it off) answers no weather at all:
        // Disabled, not configured, the longest wait, the credit, and every airport without a report.
        var read = await new GetOccRegionWeatherHandler(new Resolver(reader), new Airports(), new DisabledRegionWeatherSource(),
            new FixedClock(Now)).HandleAsync(AccountId, PuntaCana, Ct);

        Assert.True(read.IsSuccess);
        var data = read.Value!;
        Assert.Equal((PuntaCana, AerodromeWeatherStatus.Disabled, (string?)RegionWeatherReasons.NotConfigured, Now, 900),
            (data.StationId, data.Status, data.Reason, data.ServerTime, data.RefreshAfterSeconds));
        Assert.Same(AerodromeWeatherAttribution.NoaaAviationWeatherCenter, data.Credit);
        Assert.Equal(32, data.Stations.Count);
        Assert.All(data.Stations, station => Assert.Equal(((AerodromeMetar?)null, (int?)null, (AerodromeTaf?)null),
            (station.Metar, station.CeilingFeet, station.Taf)));
    }

    [Fact]
    public async Task IsLiveWhileOneMetarIsRecentAndStaleOnceEveryOneIsOlderThanNinetyMinutes()
    {
        var reader = Member(MapPermissions);

        // The region is live while any of its METARs is at most 90 minutes old, and stale without a reason once all are
        // older: an airport that stopped reporting does not make the region stale.
        foreach (var (newest, expected) in new[]
                 {
                     (89, AerodromeWeatherStatus.Live), (90, AerodromeWeatherStatus.Live), (91, AerodromeWeatherStatus.Stale),
                     (-5, AerodromeWeatherStatus.Live), (600, AerodromeWeatherStatus.Stale),
                 })
        {
            var metars = Metars(("MDPC", Metar("MDPC", Now.AddMinutes(-newest))), ("MDSD", Metar("MDSD", Now.AddHours(-5))));
            var read = await Handler(reader, new Airports(), new Weather(_ => Data(metars)))
                .HandleAsync(AccountId, PuntaCana, Ct);
            Assert.Equal((expected, (string?)null, 300), (read.Value!.Status, read.Value.Reason, read.Value.RefreshAfterSeconds));
        }

        // The rule itself, pure.
        Assert.Equal((AerodromeWeatherStatus.Live, (string?)null),
            RegionWeatherStatus.Of(Data(Metars(("MDPC", Metar("MDPC", Now.AddMinutes(-90))))), Now));
        Assert.Equal((AerodromeWeatherStatus.Stale, (string?)null),
            RegionWeatherStatus.Of(Data(Metars(("MDPC", Metar("MDPC", Now.AddMinutes(-90).AddSeconds(-1))))), Now));
        Assert.Equal((AerodromeWeatherStatus.Disabled, (string?)"not_configured"), RegionWeatherStatus.Of(null, Now));
    }

    [Fact]
    public async Task MetarsKeptAfterAFailureAreStaleWithTheReasonAndTheRestOfTheWait()
    {
        var reader = Member(MapPermissions);
        var metars = Metars(("MDPC", Metar("MDPC", Now.AddMinutes(-10))));

        // The source keeps the METARs read before because the last read failed; the screens ask again once the source will
        // have asked the service, within five and fifteen minutes.
        foreach (var (failure, retryInSeconds, reason, refresh) in new (WeatherServiceFailure, int?, string, int)[]
                 {
                     (WeatherServiceFailure.Failed, 60, "provider_error", 300),
                     (WeatherServiceFailure.Failed, 480, "provider_error", 480),
                     (WeatherServiceFailure.Failed, 479, "provider_error", 479),
                     (WeatherServiceFailure.RateLimited, 1_800, "rate_limited", 900),
                     (WeatherServiceFailure.RateLimited, 900, "rate_limited", 900),
                     (WeatherServiceFailure.Failed, 0, "provider_error", 300),
                     (WeatherServiceFailure.Failed, -60, "provider_error", 300),
                     (WeatherServiceFailure.Failed, null, "provider_error", 300),
                 })
        {
            var data = Data(metars, keptAfterFailure: true, failure: failure,
                retryAt: retryInSeconds is { } seconds ? Now.AddSeconds(seconds) : null);
            var read = await Handler(reader, new Airports(), new Weather(_ => data)).HandleAsync(AccountId, PuntaCana, Ct);
            Assert.True(read.IsSuccess);
            Assert.Equal((AerodromeWeatherStatus.Stale, (string?)reason, refresh),
                (read.Value!.Status, read.Value.Reason, read.Value.RefreshAfterSeconds));
            Assert.NotNull(read.Value.Stations[0].Metar);
        }

        // A wait that does not end on a whole second asks a second later, never sooner.
        Assert.Equal(481, RegionWeatherStatus.RefreshAfterSeconds(Data(metars, true, WeatherServiceFailure.Failed,
            Now.AddSeconds(480.2)), Now));
        Assert.Equal((300, 900), ((int)RegionWeatherStatus.MinRefreshAfter.TotalSeconds,
            (int)RegionWeatherStatus.MaxRefreshAfter.TotalSeconds));
    }

    [Fact]
    public async Task WithoutAnyMetarItIsUnavailableAndKeepsTheTafs()
    {
        var reader = Member(MapPermissions);
        var tafs = Tafs(("MDPC", Taf("MDPC")));

        // The service answered without METARs: unavailable, with nothing to explain, and the TAFs still come.
        var empty = await Handler(reader, new Airports(), new Weather(_ => Data(Metars(), tafs: tafs)))
            .HandleAsync(AccountId, PuntaCana, Ct);
        Assert.Equal((AerodromeWeatherStatus.Unavailable, (string?)null, 300),
            (empty.Value!.Status, empty.Value.Reason, empty.Value.RefreshAfterSeconds));
        Assert.NotNull(empty.Value.Stations[0].Taf);

        // The read failed and nothing kept may be served: unavailable, with the reason and the rest of the wait.
        foreach (var (failure, reason) in new[]
                 {
                     (WeatherServiceFailure.Failed, RegionWeatherReasons.ProviderError),
                     (WeatherServiceFailure.RateLimited, RegionWeatherReasons.RateLimited),
                 })
        {
            var read = await Handler(reader, new Airports(),
                    new Weather(_ => Data(Metars(), failure: failure, retryAt: Now.AddMinutes(8))))
                .HandleAsync(AccountId, PuntaCana, Ct);
            Assert.Equal((AerodromeWeatherStatus.Unavailable, (string?)reason, 480),
                (read.Value!.Status, read.Value.Reason, read.Value.RefreshAfterSeconds));
            Assert.All(read.Value.Stations, station => Assert.Null(station.Metar));
        }
        Assert.Equal(["not_configured", "rate_limited", "provider_error"], RegionWeatherReasons.All);
    }

    [Fact]
    public async Task AFaultOfTheSourceIsUnavailableAndOnlyTheCallersCancellationIsThrown()
    {
        var reader = Member(MapPermissions);

        // A source that throws (a fault of its own code, not of the service) still answers the region: unavailable.
        foreach (var fault in new Exception[]
                 {
                     new InvalidOperationException("synthetic fault"), new HttpRequestException("synthetic"),
                     new OperationCanceledException("a timeout of its own"), new ArgumentOutOfRangeException("icaoCodes"),
                 })
        {
            var read = await Handler(reader, new Airports(), new Weather(_ => throw fault)).HandleAsync(AccountId, PuntaCana, Ct);
            Assert.Equal((AerodromeWeatherStatus.Unavailable, (string?)RegionWeatherReasons.ProviderError, 300, 32),
                (read.Value!.Status, read.Value.Reason, read.Value.RefreshAfterSeconds, read.Value.Stations.Count));
            Assert.All(read.Value.Stations, station => Assert.Equal(((AerodromeMetar?)null, (AerodromeTaf?)null),
                (station.Metar, station.Taf)));
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
            Handler(reader, new Airports(), weather).HandleAsync(AccountId, PuntaCana, cancelled.Token));
    }

    [Fact]
    public async Task EachAirportCarriesTheCeilingOfItsMetar()
    {
        var reader = Member(MapPermissions);
        var metars = Metars(
            ("MDPC", Metar("MDPC", Now.AddMinutes(-10), new("FEW", 1800), new("BKN", 2500), new("OVC", 1200))),
            ("MDSD", Metar("MDSD", Now.AddMinutes(-10), new("FEW", 2000), new("SCT", 3500))),
            ("MTPP", Metar("MTPP", Now.AddMinutes(-10), new AerodromeCloudLayer("VV", 200))),
            ("TJSJ", Metar("TJSJ", Now.AddMinutes(-10), new("SCT", 1500), new("BKN", null), new("OVC", 4000))));

        var read = await Handler(reader, new Airports(), new Weather(_ => Data(metars))).HandleAsync(AccountId, PuntaCana, Ct);

        // The lowest broken, overcast or obscured base; scattered layers make none; a ceiling layer without its base makes
        // the ceiling unknown; an airport without a METAR has none.
        var ceilings = read.Value!.Stations.ToDictionary(station => station.Station.IcaoCode, station => station.CeilingFeet);
        Assert.Equal(((int?)1200, (int?)null, (int?)200, (int?)null, (int?)null),
            (ceilings["MDPC"], ceilings["MDSD"], ceilings["MTPP"], ceilings["TJSJ"], ceilings["MDLR"]));

        // The rule itself, pure.
        Assert.Equal(["BKN", "OVC", "OVX", "VV"], MetarCeiling.Covers);
        Assert.Equal(300, MetarCeiling.Of([new("OVX", 300), new("CAVOK", null)]));
        Assert.Null(MetarCeiling.Of([]));
        Assert.Null(MetarCeiling.Of([new("CAVOK", null)]));
        Assert.Null(MetarCeiling.Of([new("FEW", 1000), new("SCT", 2000)]));
        Assert.Equal(0, MetarCeiling.Of([new("OVC", 0)]));
    }

    [Fact]
    public void ThePuntaCanaRegionHasItsThirtyTwoAirportsNearestFirst()
    {
        var region = RegionWeatherStations.AroundPuntaCana;

        Assert.Equal(32, region.Count);
        Assert.Equal(("MDPC", "PUJ", "Punta Cana International Airport"), (region[0].IcaoCode, region[0].IataCode, region[0].Name));
        Assert.Equal(32, region.Select(station => station.IcaoCode).Distinct(StringComparer.Ordinal).Count());
        Assert.All(region, station =>
        {
            // What the Data API is asked with and what the screens show.
            Assert.Matches("^[A-Z]{4}$", station.IcaoCode);
            if (station.IataCode is not null) Assert.Matches("^[A-Z]{3}$", station.IataCode);
            Assert.False(string.IsNullOrWhiteSpace(station.Name));
            // Within the Caribbean box the maps draw in Región.
            Assert.InRange(station.Latitude, 17, 23);
            Assert.InRange(station.Longitude, -73.5, -63);
        });
        // San Isidro Air Base has no IATA code.
        Assert.Equal(["MDSI"], region.Where(station => station.IataCode is null).Select(station => station.IcaoCode));
        Assert.Equal("TNCS", region[^1].IcaoCode);

        // Only Punta Cana's airport, exactly as the station's airport store writes it, has a region.
        Assert.Same(region, RegionWeatherStations.Around("MDPC"));
        Assert.Equal("MDPC", RegionWeatherStations.PuntaCanaIcao);
        foreach (var other in new string?[] { "MDSD", "mdpc", " MDPC", "", null })
            Assert.Null(RegionWeatherStations.Around(other));
    }

    private static GetOccRegionWeatherHandler Handler(ActorContext? actor, Airports airports, IRegionWeatherSource weather) =>
        new(new Resolver(actor), airports, weather, new FixedClock(Now));

    private static RegionWeatherData Data(IReadOnlyDictionary<string, AerodromeMetar> metars, bool keptAfterFailure = false,
        WeatherServiceFailure? failure = null, DateTimeOffset? retryAt = null,
        IReadOnlyDictionary<string, AerodromeTaf>? tafs = null) =>
        new(metars, keptAfterFailure, tafs ?? Tafs(), failure, retryAt);

    private static ReadOnlyDictionary<string, AerodromeMetar> Metars(params (string Icao, AerodromeMetar Metar)[] metars) =>
        new(metars.ToDictionary(item => item.Icao, item => item.Metar, StringComparer.Ordinal));

    private static ReadOnlyDictionary<string, AerodromeTaf> Tafs(params (string Icao, AerodromeTaf Taf)[] tafs) =>
        new(tafs.ToDictionary(item => item.Icao, item => item.Taf, StringComparer.Ordinal));

    /// <summary>An invented METAR of <paramref name="icao"/>; by default a few clouds and a broken layer at 8 000 ft.</summary>
    private static AerodromeMetar Metar(string icao, DateTimeOffset observedAt, params AerodromeCloudLayer[] clouds) =>
        new($"{icao} 131500Z 09014KT 9999 FEW018 BKN080 29/22 Q1015", observedAt, "VFR", 90, false, 14, null, 6, 29, 22, 1015,
            null, clouds.Length == 0 ? [new AerodromeCloudLayer("FEW", 1800), new AerodromeCloudLayer("BKN", 8000)] : clouds);

    /// <summary>An invented TAF of <paramref name="icao"/> valid for a day from 12:00.</summary>
    private static AerodromeTaf Taf(string icao)
    {
        var from = new DateTimeOffset(2026, 11, 13, 12, 0, 0, TimeSpan.Zero);
        return new AerodromeTaf($"TAF {icao} 131100Z 1312/1412 09012KT 9999 FEW020", from.AddHours(-1), from, from.AddHours(24),
            [new AerodromeTafPeriod(from, from.AddHours(24), null, null, 90, false, 12, null, 6, null, [])]);
    }

    /// <summary>AVIAM internal staff of Operations with the given permissions, Punta Cana and Santo Domingo in scope.</summary>
    private static ActorContext Member(params string[] permissions) => new(AccountId, "occ.region@example.test",
        "OCC Region Reader",
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

    /// <summary>A region source that answers what <paramref name="answer"/> says, and records every list of codes asked for.</summary>
    private sealed class Weather(Func<IReadOnlyList<string>, RegionWeatherData?> answer) : IRegionWeatherSource
    {
        public List<IReadOnlyList<string>> Requests { get; } = [];

        public Task<RegionWeatherData?> ReadAsync(IReadOnlyList<string> icaoCodes, CancellationToken cancellationToken = default)
        {
            Requests.Add(icaoCodes);
            return Task.FromResult(answer(icaoCodes));
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
