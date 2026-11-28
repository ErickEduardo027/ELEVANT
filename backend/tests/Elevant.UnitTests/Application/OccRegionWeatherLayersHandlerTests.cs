using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.Weather;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// Plan M6: the SIGMETs, wind grid and radar frames of the region around a station's airport are read by the readers of
/// the region's METARs (AVIAM internal staff with the station in scope and any of the four map permissions); only Punta
/// Cana has a region. Each layer's state comes in the success with its reason, when to ask again and its credit. The
/// airports, the actor and the sources are stubs with invented values: nothing reaches a database or the network.
/// </summary>
public sealed class OccRegionWeatherLayersHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 30, 0, TimeSpan.Zero);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000047");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SantoDomingo = Guid.Parse("20000000-0000-7000-8000-000000000004");
    private static readonly Guid Elsewhere = Guid.Parse("20000000-0000-7000-8000-000000000099");

    private static readonly string[] MapPermissions =
    [
        "operations.dashboard.read", "operations.flight_monitoring.read", "operations.positions_map.read",
        "operations.planning.read",
    ];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task EveryMapReaderReadsTheThreeLayersOfPuntaCana()
    {
        var sources = new Sources
        {
            Sigmets = Layer<IReadOnlyList<RegionSigmet>>([Sigmet("B", Now.AddHours(2)), Sigmet("A", Now.AddHours(1)),
                Sigmet("C", Now.AddHours(1)), Sigmet("OLD", Now)]),
            Wind = Layer(Grid(Now.AddMinutes(-15))),
            Radar = Layer(Frames(Now.AddMinutes(-4))),
        };

        foreach (var permission in MapPermissions)
        {
            var handler = Handler(Member(permission), sources);

            var sigmets = (await handler.SigmetsAsync(AccountId, PuntaCana, Ct)).Value!;
            Assert.Equal((PuntaCana, AerodromeWeatherStatus.Live, (string?)null, Now, 600),
                (sigmets.StationId, sigmets.Status, sigmets.Reason, sigmets.ServerTime, sigmets.RefreshAfterSeconds));
            Assert.Equal(AerodromeWeatherAttribution.NoaaAviationWeatherCenter, sigmets.Credit);
            // One that ends now is past its validity; the others by the end of their validity, then by id.
            Assert.Equal(["A", "C", "B"], sigmets.Sigmets.Select(sigmet => sigmet.Id));

            var wind = (await handler.WindAsync(AccountId, PuntaCana, Ct)).Value!;
            Assert.Equal((AerodromeWeatherStatus.Live, (string?)null, 3600, (DateTimeOffset?)Now.AddMinutes(-15)),
                (wind.Status, wind.Reason, wind.RefreshAfterSeconds, wind.ValidAt));
            Assert.Equal(AerodromeWeatherAttribution.OpenMeteo, wind.Credit);
            Assert.Equal(2, wind.Grid.Points.Count);

            var radar = (await handler.RadarAsync(AccountId, PuntaCana, Ct)).Value!;
            Assert.Equal((AerodromeWeatherStatus.Live, (string?)null, 300, "iem-tjua", 10, 2),
                (radar.Status, radar.Reason, radar.RefreshAfterSeconds, radar.Provider, radar.MaxZoom, radar.Frames.Count));
            Assert.Equal(AerodromeWeatherAttribution.IowaEnvironmentalMesonet, radar.Credit);
        }

        // Every source was asked about Punta Cana's box, and the radar source with San Juan's NEXRAD.
        Assert.All(sources.Areas, area => Assert.Equal(RegionWeatherStations.PuntaCanaArea, area));
        Assert.Equal(3 * MapPermissions.Length, sources.Areas.Count);
        Assert.Equal((-76d, -60d, 12d, 24d, "TJUA"), (RegionWeatherStations.PuntaCanaArea.LongitudeMin,
            RegionWeatherStations.PuntaCanaArea.LongitudeMax, RegionWeatherStations.PuntaCanaArea.LatitudeMin,
            RegionWeatherStations.PuntaCanaArea.LatitudeMax, RegionWeatherStations.PuntaCanaArea.RadarSite));
    }

    [Fact]
    public async Task RefusesWhatTheRegionsMetarsRefuseBeforeAnySourceIsAsked()
    {
        var sources = new Sources();
        var airline = Member(MapPermissions) with
        {
            Memberships = [Member().Memberships[0] with { OrganizationType = OrganizationType.AirlineCustomer,
                Kind = MembershipKind.AirlineClient }],
        };
        var reader = Member(MapPermissions);

        foreach (var (actor, account, station, failure) in new (ActorContext?, Guid, Guid, OccMapFailure)[]
                 {
                     (Member("operations.review.read"), AccountId, PuntaCana, OccMapFailure.Forbidden),
                     (airline, AccountId, PuntaCana, OccMapFailure.Forbidden),
                     (null, AccountId, PuntaCana, OccMapFailure.Unauthorized),
                     (reader, Guid.Empty, PuntaCana, OccMapFailure.Unauthorized),
                     (reader, AccountId, Guid.Empty, OccMapFailure.InvalidRequest),
                     (reader, AccountId, Elsewhere, OccMapFailure.NotFound),
                     // Santo Domingo is in scope but has no region of its own.
                     (reader, AccountId, SantoDomingo, OccMapFailure.NotFound),
                 })
        {
            var handler = Handler(actor, sources);
            Assert.Equal(failure, (await handler.SigmetsAsync(account, station, Ct)).Failure);
            Assert.Equal(failure, (await handler.WindAsync(account, station, Ct)).Failure);
            Assert.Equal(failure, (await handler.RadarAsync(account, station, Ct)).Failure);
        }
        Assert.Empty(sources.Areas);
    }

    [Fact]
    public async Task WithoutAServiceEachLayerIsDisabledAndAsksAtItsLongestPace()
    {
        var handler = Handler(Member(MapPermissions), new Sources());

        var sigmets = (await handler.SigmetsAsync(AccountId, PuntaCana, Ct)).Value!;
        var wind = (await handler.WindAsync(AccountId, PuntaCana, Ct)).Value!;
        var radar = (await handler.RadarAsync(AccountId, PuntaCana, Ct)).Value!;

        Assert.Equal((AerodromeWeatherStatus.Disabled, RegionWeatherReasons.NotConfigured, 900, 0),
            (sigmets.Status, sigmets.Reason, sigmets.RefreshAfterSeconds, sigmets.Sigmets.Count));
        // The grid keeps the region's box and shape without points.
        Assert.Equal((AerodromeWeatherStatus.Disabled, RegionWeatherReasons.NotConfigured, 3600, (DateTimeOffset?)null),
            (wind.Status, wind.Reason, wind.RefreshAfterSeconds, wind.ValidAt));
        Assert.Equal((RegionWeatherStations.PuntaCanaArea, 10, 8, 0),
            (wind.Grid.Area, wind.Grid.Columns, wind.Grid.Rows, wind.Grid.Points.Count));
        Assert.Equal((AerodromeWeatherStatus.Disabled, RegionWeatherReasons.NotConfigured, 900, (string?)null, 0, 0),
            (radar.Status, radar.Reason, radar.RefreshAfterSeconds, radar.Provider, radar.MaxZoom, radar.Frames.Count));
        // The credit is said also while the layer is off.
        Assert.Equal(AerodromeWeatherAttribution.OpenMeteo, wind.Credit);
    }

    [Fact]
    public async Task AFailingServiceIsAStateOfTheLayer()
    {
        var sources = new Sources
        {
            // Kept after a 429, the service asked again in twenty minutes: stale, rate limited, at most fifteen minutes.
            Sigmets = new RegionWeatherLayer<IReadOnlyList<RegionSigmet>>([Sigmet("A", Now.AddHours(1))], true,
                WeatherServiceFailure.RateLimited, Now.AddMinutes(20)),
            // Nothing to serve after a failure, asked again in two minutes: unavailable, the shortest wait of five minutes.
            Wind = RegionWeatherLayer<RegionWindGrid>.Without(WeatherServiceFailure.Failed) with { RetryAt = Now.AddMinutes(2) },
            // The source itself breaks: unavailable, a provider error.
            RadarFault = new InvalidOperationException("broken"),
        };
        var handler = Handler(Member(MapPermissions), sources);

        var sigmets = (await handler.SigmetsAsync(AccountId, PuntaCana, Ct)).Value!;
        Assert.Equal((AerodromeWeatherStatus.Stale, RegionWeatherReasons.RateLimited, 900, 1),
            (sigmets.Status, sigmets.Reason, sigmets.RefreshAfterSeconds, sigmets.Sigmets.Count));

        var wind = (await handler.WindAsync(AccountId, PuntaCana, Ct)).Value!;
        Assert.Equal((AerodromeWeatherStatus.Unavailable, RegionWeatherReasons.ProviderError, 300, 0),
            (wind.Status, wind.Reason, wind.RefreshAfterSeconds, wind.Grid.Points.Count));

        var radar = (await handler.RadarAsync(AccountId, PuntaCana, Ct)).Value!;
        Assert.Equal((AerodromeWeatherStatus.Unavailable, RegionWeatherReasons.ProviderError, 300, (string?)null),
            (radar.Status, radar.Reason, radar.RefreshAfterSeconds, radar.Provider));

        // A retry in 7.5 minutes is asked for in whole seconds.
        sources.Sigmets = sources.Sigmets with { RetryAt = Now.AddSeconds(450.2) };
        Assert.Equal(451, (await handler.SigmetsAsync(AccountId, PuntaCana, Ct)).Value!.RefreshAfterSeconds);
    }

    [Fact]
    public async Task OldValuesAreStaleAndARadarWithoutScansIsUnavailable()
    {
        var sources = new Sources
        {
            Wind = Layer(Grid(Now - RegionWeatherLayerStatus.LiveWindAge - TimeSpan.FromSeconds(1))),
            Radar = Layer(Frames(Now - RegionWeatherLayerStatus.LiveRadarAge - TimeSpan.FromSeconds(1))),
            // Every SIGMET kept is past its validity: none is served, and the state is still the service's.
            Sigmets = Layer<IReadOnlyList<RegionSigmet>>([Sigmet("OLD", Now.AddMinutes(-1))]),
        };
        var handler = Handler(Member(MapPermissions), sources);

        Assert.Equal((AerodromeWeatherStatus.Stale, (string?)null),
            Shape((await handler.WindAsync(AccountId, PuntaCana, Ct)).Value!));
        var radar = (await handler.RadarAsync(AccountId, PuntaCana, Ct)).Value!;
        Assert.Equal((AerodromeWeatherStatus.Stale, (string?)null, 2), (radar.Status, radar.Reason, radar.Frames.Count));
        var sigmets = (await handler.SigmetsAsync(AccountId, PuntaCana, Ct)).Value!;
        Assert.Equal((AerodromeWeatherStatus.Live, 0), (sigmets.Status, sigmets.Sigmets.Count));

        // Right at their limits they are still live.
        sources.Wind = Layer(Grid(Now - RegionWeatherLayerStatus.LiveWindAge));
        sources.Radar = Layer(Frames(Now - RegionWeatherLayerStatus.LiveRadarAge));
        Assert.Equal(AerodromeWeatherStatus.Live, (await handler.WindAsync(AccountId, PuntaCana, Ct)).Value!.Status);
        Assert.Equal(AerodromeWeatherStatus.Live, (await handler.RadarAsync(AccountId, PuntaCana, Ct)).Value!.Status);

        // A provider that answered without scans has nothing to draw.
        sources.Radar = Layer(new RegionRadarFrames("iem-tjua", 10, []));
        var empty = (await handler.RadarAsync(AccountId, PuntaCana, Ct)).Value!;
        Assert.Equal((AerodromeWeatherStatus.Unavailable, (string?)null, (string?)null, 0, 0),
            (empty.Status, empty.Reason, empty.Provider, empty.MaxZoom, empty.Frames.Count));
    }

    [Fact]
    public async Task TheCallersCancellationIsThrown()
    {
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();
        var sources = new Sources { RadarFault = new OperationCanceledException(cancellation.Token) };
        var handler = Handler(Member(MapPermissions), sources);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => handler.RadarAsync(AccountId, PuntaCana, cancellation.Token));
    }

    private static (string, string?) Shape(OccRegionWindData data) => (data.Status, data.Reason);

    private static GetOccRegionWeatherLayersHandler Handler(ActorContext? actor, Sources sources) =>
        new(new Resolver(actor), new Airports(), sources, sources, sources, new FixedClock(Now));

    private static RegionWeatherLayer<T> Layer<T>(T value) where T : class => new(value, false, null, null);

    private static RegionSigmet Sigmet(string id, DateTimeOffset validTo) => new(id, "TJZS", "TS", "EMBD",
        validTo.AddHours(-4), validTo, null, 45000, $"TJZS SIGMET {id}",
        [new(-67.5, 18.5), new(-66, 19.5), new(-65, 18), new(-67.5, 18.5)]);

    private static RegionWindGrid Grid(DateTimeOffset validAt) => new(validAt, RegionWeatherStations.PuntaCanaArea, 10, 8,
        [new RegionWindPoint(12, -76, 12.5, 90), new RegionWindPoint(12, -74.222, 14, 100)]);

    private static RegionRadarFrames Frames(DateTimeOffset latest) => new("iem-tjua", 10,
    [
        new RegionRadarFrame(latest.AddMinutes(-5), "https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-1/{z}/{x}/{y}.png"),
        new RegionRadarFrame(latest, "https://mesonet.agron.iastate.edu/c/tile.py/1.0.0/ridge::JUA-N0B-2/{z}/{x}/{y}.png"),
    ]);

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
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    private sealed class Airports : IOccStationAirportStore
    {
        public Task<string?> FindIcaoCodeAsync(Guid stationId, CancellationToken cancellationToken = default) =>
            Task.FromResult(stationId == PuntaCana ? "MDPC" : stationId == SantoDomingo ? "MDSD" : null);
    }

    /// <summary>The three sources at once: each answers its layer (null: no service), and every box asked about is recorded.</summary>
    private sealed class Sources : IRegionSigmetSource, IRegionWindSource, IRegionRadarSource
    {
        public RegionWeatherLayer<IReadOnlyList<RegionSigmet>>? Sigmets { get; set; }

        public RegionWeatherLayer<RegionWindGrid>? Wind { get; set; }

        public RegionWeatherLayer<RegionRadarFrames>? Radar { get; set; }

        public Exception? RadarFault { get; set; }

        public List<RegionWeatherArea> Areas { get; } = [];

        Task<RegionWeatherLayer<IReadOnlyList<RegionSigmet>>?> IRegionSigmetSource.ReadAsync(RegionWeatherArea area,
            CancellationToken cancellationToken)
        {
            Areas.Add(area);
            return Task.FromResult(Sigmets);
        }

        Task<RegionWeatherLayer<RegionWindGrid>?> IRegionWindSource.ReadAsync(RegionWeatherArea area,
            CancellationToken cancellationToken)
        {
            Areas.Add(area);
            return Task.FromResult(Wind);
        }

        Task<RegionWeatherLayer<RegionRadarFrames>?> IRegionRadarSource.ReadAsync(RegionWeatherArea area,
            CancellationToken cancellationToken)
        {
            Areas.Add(area);
            return RadarFault is { } fault ? Task.FromException<RegionWeatherLayer<RegionRadarFrames>?>(fault) : Task.FromResult(Radar);
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
