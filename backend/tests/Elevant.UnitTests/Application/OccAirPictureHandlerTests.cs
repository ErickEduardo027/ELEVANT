using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations.AirPicture;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0042 (contracts 1.3): the air picture and an aircraft's track are read by AVIAM internal staff with the station in
/// scope and any map permission, only for the station with live traffic. A read is demand for the network; the picture's
/// own state comes in the success; the flights are read only to match aircraft, and each matched aircraft carries its
/// flight's key. Every network and store here is a stub: nothing calls out.
/// </summary>
public sealed class OccAirPictureHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000042");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SantoDomingo = Guid.Parse("20000000-0000-7000-8000-000000000004");
    private static readonly AirTrafficAttribution Credit = new("synthetic", "https://synthetic.example", "Test only", null);

    private static readonly string[] MapPermissions =
    [
        "operations.dashboard.read", "operations.flight_monitoring.read", "operations.positions_map.read",
        "operations.planning.read",
    ];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task AuthorizesAnyMapReaderWithTheStationInScope()
    {
        var rig = new Rig();
        await rig.ReadNetworkAsync(Plane("0c0001"));

        // Each of the four map permissions opens the picture and the track of the station with live traffic.
        foreach (var permission in MapPermissions)
        {
            var reader = Member(permission);
            var picture = await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct);
            Assert.True(picture.IsSuccess, permission);
            Assert.Equal((PuntaCana, AirPictureStatus.Live), (picture.Value!.StationId, picture.Value.Picture.Status));
            Assert.Equal("0c0001", Assert.Single(picture.Value.Picture.Aircraft).Aircraft.Hex);
            var track = await rig.Track(reader).HandleAsync(AccountId, PuntaCana, "0c0001", Ct);
            Assert.True(track.IsSuccess, permission);
        }

        // Another permission of Operations alone opens nothing, and neither does a map permission outside AVIAM's staff.
        var reviewer = Member("operations.review.read");
        var airline = Member(MapPermissions) with
        {
            Memberships = [Member().Memberships[0] with { OrganizationType = OrganizationType.AirlineCustomer,
                Kind = MembershipKind.AirlineClient }],
        };
        foreach (var refused in new[] { reviewer, airline })
        {
            Assert.Equal(OccMapFailure.Forbidden,
                (await rig.AirPicture(refused).HandleAsync(AccountId, PuntaCana, null, Ct)).Failure);
            Assert.Equal(OccMapFailure.Forbidden,
                (await rig.Track(refused).HandleAsync(AccountId, PuntaCana, "0c0001", Ct)).Failure);
        }

        // No session, an account the resolver does not know, or an actor of another account: unauthorized.
        Assert.Equal(OccMapFailure.Unauthorized,
            (await rig.AirPicture(Member(MapPermissions)).HandleAsync(Guid.Empty, PuntaCana, null, Ct)).Failure);
        Assert.Equal(OccMapFailure.Unauthorized, (await rig.AirPicture(null).HandleAsync(AccountId, PuntaCana, null, Ct)).Failure);
        Assert.Equal(OccMapFailure.Unauthorized, (await rig.AirPicture(Member(MapPermissions) with
            { AccountId = Guid.NewGuid() }).HandleAsync(AccountId, PuntaCana, null, Ct)).Failure);
        Assert.Equal(OccMapFailure.Unauthorized, (await rig.Track(null).HandleAsync(AccountId, PuntaCana, "0c0001", Ct)).Failure);
    }

    [Fact]
    public async Task AnswersDisabledWithoutAProvider()
    {
        // The default of every host (AirTraffic off), and a section switched on with no network to read.
        foreach (var (provider, settings) in new (IAirTrafficProvider, AirTrafficSettings)[]
                 {
                     (new UnconfiguredAirTrafficProvider(), AirTrafficSettings.Disabled),
                     (new UnconfiguredAirTrafficProvider(), Settings()),
                     (new ScriptedNetwork(new ManualClock(Now)), Settings() with { Enabled = false }),
                 })
        {
            var rig = new Rig(provider, settings);
            var read = await rig.AirPicture(Member("operations.dashboard.read")).HandleAsync(AccountId, PuntaCana,
                OccAirPictureTrails.ShortTrails, Ct);

            Assert.True(read.IsSuccess);
            var picture = read.Value!.Picture;
            Assert.Equal((AirPictureStatus.Disabled, AirPictureReasons.NotConfigured, 60, (AirTrafficAttribution?)null),
                (picture.Status, picture.Reason, picture.RefreshAfterSeconds, picture.Source));
            Assert.Equal((Now, (DateTimeOffset?)null, (int?)null), (picture.ServerTime, picture.ObservedAt, picture.AgeSeconds));
            Assert.Empty(picture.Aircraft);
            Assert.Empty(read.Value.Matches);
            // The circle still says where the picture would be: Punta Cana and 250 nautical miles.
            Assert.Equal(new AirTrafficArea(18.5674, -68.3634, 250), read.Value.Center);
            // A disabled picture is never demand, and nothing reads the network or the flights.
            Assert.False(rig.Picture.HasDemand);
            Assert.Equal(0, rig.Keys.Calls);
            if (provider is ScriptedNetwork network) Assert.Equal(0, network.Reads);
            // Without a picture there is no track either.
            Assert.Equal(OccMapFailure.NotFound,
                (await rig.Track(Member("operations.dashboard.read")).HandleAsync(AccountId, PuntaCana, "0c0001", Ct)).Failure);
        }
    }

    [Fact]
    public async Task AttachesTheMatchedFlightKey()
    {
        var rig = new Rig();
        const string ByRegistration = "p:0193a6f2-0000-7000-8000-000000000171";
        const string ByCallsign = "l:0193a6f2-0000-7000-8000-000000000172";
        rig.Keys.Keys =
        [
            Key(ByRegistration, "ZZ171", registration: "HI-1002"),
            Key(ByCallsign, "ZZ0172"),
            // A demo flight with the same callsign as a live aircraft: its aircraft is not real, it never matches.
            Key("p:0193a6f2-0000-7000-8000-000000000901", "ZZ9001", demo: true),
        ];
        await rig.ReadNetworkAsync(Plane("0c0001", registration: "HI1002"), Plane("0c0002", callsign: "DZZ172"),
            Plane("0c0003", callsign: "DZZ9001"), Plane("0c0004", callsign: "XYZ1"));

        var reader = Member("operations.flight_monitoring.read");
        var read = await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct);
        Assert.True(read.IsSuccess);
        Assert.Equal(4, read.Value!.Picture.Aircraft.Count);
        Assert.Equal(new Dictionary<string, FlightMatch>
            {
                ["0c0001"] = new(ByRegistration, FlightMatch.ByRegistration),
                ["0c0002"] = new(ByCallsign, FlightMatch.ByCallsign),
            }, read.Value.Matches);
        // The flights are read for the station and the instant of the request.
        Assert.Equal([(PuntaCana, Now)], rig.Keys.Requests);

        // Within twenty seconds every read reuses them; afterwards they are read again.
        rig.Clock.Advance(TimeSpan.FromSeconds(19));
        Assert.Equal(2, (await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, OccAirPictureTrails.NoTrails, Ct))
            .Value!.Matches.Count);
        Assert.Equal(1, rig.Keys.Calls);
        rig.Clock.Advance(TimeSpan.FromSeconds(2));
        await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct);
        Assert.Equal(2, rig.Keys.Calls);

        // «short» brings the trail of each aircraft and «none» none; the matches are the same.
        rig.Clock.Advance(TimeSpan.FromSeconds(10));
        await rig.ReadNetworkAsync(Plane("0c0001", registration: "HI1002", latitude: 18.6), Plane("0c0002", callsign: "DZZ172"));
        var withTrails = (await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, OccAirPictureTrails.ShortTrails, Ct))
            .Value!;
        var withoutTrails = (await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, OccAirPictureTrails.NoTrails, Ct))
            .Value!;
        Assert.Equal(2, withTrails.Picture.Aircraft.Single(item => item.Aircraft.Hex == "0c0001").Trail.Count);
        Assert.All(withoutTrails.Picture.Aircraft, item => Assert.Empty(item.Trail));
        Assert.Equal(withTrails.Matches, withoutTrails.Matches);

        // The flights out of reach (the database fails): the aircraft still come, without a flight, until they are read.
        var broken = new Rig();
        broken.Keys.Failure = new InvalidOperationException("The database is out of reach.");
        await broken.ReadNetworkAsync(Plane("0c0001", registration: "HI1002"));
        var unmatched = await broken.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct);
        Assert.Equal((true, AirPictureStatus.Live, 1), (unmatched.IsSuccess, unmatched.Value!.Picture.Status,
            unmatched.Value.Picture.Aircraft.Count));
        Assert.Empty(unmatched.Value.Matches);
        Assert.Equal(1, broken.Keys.Calls);
    }

    [Fact]
    public async Task AnotherStationIsNotFound()
    {
        var rig = new Rig();
        var reader = Member(MapPermissions);

        // A station outside the scope, and Santo Domingo, in scope but without live traffic: not found, before any demand.
        foreach (var station in new[] { Guid.Parse("20000000-0000-7000-8000-000000000099"), SantoDomingo })
        {
            Assert.Equal(OccMapFailure.NotFound, (await rig.AirPicture(reader).HandleAsync(AccountId, station, null, Ct)).Failure);
            Assert.Equal(OccMapFailure.NotFound,
                (await rig.Track(reader).HandleAsync(AccountId, station, "0c0001", Ct)).Failure);
        }
        Assert.False(rig.Picture.HasDemand);
        Assert.Equal((0, 0), (rig.Network.Reads, rig.Keys.Calls));

        // The station with live traffic is the configured one, in any case: with SDQ, Santo Domingo has it and Punta Cana not.
        var moved = new Rig(settings: Settings() with { StationCode = "sdq" });
        Assert.True((await moved.AirPicture(reader).HandleAsync(AccountId, SantoDomingo, null, Ct)).IsSuccess);
        Assert.Equal(OccMapFailure.NotFound, (await moved.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct)).Failure);

        // A missing station or an unknown trail choice is an invalid request, before the actor is resolved.
        var resolutions = rig.Resolutions;
        foreach (var (station, trails) in new (Guid, string?)[]
                     { (Guid.Empty, null), (PuntaCana, "long"), (PuntaCana, "SHORT"), (PuntaCana, ""), (PuntaCana, " none") })
            Assert.Equal(OccMapFailure.InvalidRequest,
                (await rig.AirPicture(reader).HandleAsync(AccountId, station, trails, Ct)).Failure);
        Assert.False(rig.Picture.HasDemand);
        Assert.Equal(resolutions, rig.Resolutions);
    }

    [Fact]
    public async Task WithoutAircraftItNeverReadsTheFlights()
    {
        var rig = new Rig();
        var reader = Member("operations.positions_map.read");

        // Warming: the first read of a watch is on its way.
        var warming = await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct);
        Assert.Equal((AirPictureStatus.Warming, 2, Credit), (warming.Value!.Picture.Status,
            warming.Value.Picture.RefreshAfterSeconds, warming.Value.Picture.Source));
        Assert.True(rig.Picture.HasDemand);

        // Live with an empty sky.
        await rig.Picture.PollOnceAsync(Ct);
        var empty = await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct);
        Assert.Equal((AirPictureStatus.Live, 0), (empty.Value!.Picture.Status, empty.Value.Picture.Aircraft.Count));

        // Unavailable: the network fails and nothing good was read in ten minutes.
        rig.Network.Outcome = AirTrafficOutcome.Failed;
        rig.Clock.Advance(TimeSpan.FromMinutes(11));
        await rig.ReadNetworkAsync();
        var unavailable = await rig.AirPicture(reader).HandleAsync(AccountId, PuntaCana, null, Ct);
        Assert.Equal((AirPictureStatus.Unavailable, AirPictureReasons.ProviderError, 0), (unavailable.Value!.Picture.Status,
            unavailable.Value.Picture.Reason, unavailable.Value.Picture.Aircraft.Count));

        Assert.Equal(0, rig.Keys.Calls);
        Assert.Empty(empty.Value.Matches);
    }

    [Fact]
    public async Task ATrackNeedsSixHexDigitsAndAKnownAircraft()
    {
        var rig = new Rig();
        var reader = Member("operations.dashboard.read");

        // Six hexadecimal digits, nothing around them: anything else is invalid, before the actor or the picture.
        foreach (var hex in new[] { null, "", "0c001", "0c00011", "0c000g", " 0c0001", "~0c001", "0c 001", "0x0c01" })
            Assert.Equal(OccMapFailure.InvalidRequest, (await rig.Track(reader).HandleAsync(AccountId, PuntaCana, hex, Ct)).Failure);
        Assert.Equal(OccMapFailure.InvalidRequest,
            (await rig.Track(reader).HandleAsync(AccountId, Guid.Empty, "0c0001", Ct)).Failure);
        Assert.Equal(0, rig.Resolutions);
        Assert.False(rig.Picture.HasDemand);

        // Two reads place 0C0001: its trail comes in lower case, oldest first, with the network's credit.
        await rig.ReadNetworkAsync(Plane("0c0001"), Plane("0c0002"));
        rig.Clock.Advance(TimeSpan.FromSeconds(10));
        await rig.ReadNetworkAsync(Plane("0c0001", latitude: 18.6), Plane("0c0002"));
        var track = await rig.Track(reader).HandleAsync(AccountId, PuntaCana, "0C0001", Ct);
        Assert.True(track.IsSuccess);
        Assert.Equal(("0c0001", rig.Clock.GetUtcNow(), Credit), (track.Value!.Hex, track.Value.ServerTime, track.Value.Source));
        Assert.Equal([18.5, 18.6], track.Value.Points.Select(point => point.Latitude));
        Assert.Equal(GetOccAircraftTrackHandler.NormalizeHex("0C0001"), track.Value.Hex);

        // An address no read saw is not found.
        Assert.Equal(OccMapFailure.NotFound, (await rig.Track(reader).HandleAsync(AccountId, PuntaCana, "0c0009", Ct)).Failure);

        // A track read is demand too: after a quiet spell it wakes the reads again.
        rig.Clock.Advance(TimeSpan.FromMinutes(16));
        Assert.False(rig.Picture.HasDemand);
        Assert.Equal(OccMapFailure.NotFound, (await rig.Track(reader).HandleAsync(AccountId, PuntaCana, "0c0001", Ct)).Failure);
        Assert.True(rig.Picture.HasDemand);
    }

    private static AirTrafficSettings Settings() =>
        new(true, "PUJ", 18.5674, -68.3634, 250, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(900), TimeSpan.FromMinutes(180));

    /// <summary>AVIAM internal staff of Operations with the given permissions, Punta Cana and Santo Domingo in scope.</summary>
    private static ActorContext Member(params string[] permissions) => new(AccountId, "occ.reader@example.test", "OCC Reader",
        [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000001"), "ADMIN_OCC", "Admin OCC", PortalKind.BackOffice,
            "admin_occ")],
        [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000001"),
            Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development", OrganizationType.AviamOperator,
            MembershipKind.InternalStaff)],
        [new ActorStationScope(PuntaCana, "PUJ"), new ActorStationScope(SantoDomingo, "SDQ")],
        new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Operations,
            permissions.ToHashSet(StringComparer.Ordinal)));

    /// <summary>A synthetic aircraft: an invented address over the sea east of Punta Cana.</summary>
    private static AirTrafficAircraft Plane(string hex, string? callsign = null, string? registration = null,
        double latitude = 18.5) =>
        new(hex, callsign, registration, "A320", "A3", latitude, -68.36, 2500, false, 150, 80, -600, null, Now);

    private static MapFlightMatchKey Key(string flightKey, string flightNumber, string? registration = null, bool demo = false) =>
        new(flightKey, "Arrival", flightNumber, "DZZ", "ZZ", registration, Now.AddMinutes(20), false, demo);

    /// <summary>The picture with its network, clock and flights, and the handlers that read it.</summary>
    private sealed class Rig
    {
        private int _resolutions;

        public Rig(IAirTrafficProvider? provider = null, AirTrafficSettings? settings = null)
        {
            Network = provider as ScriptedNetwork ?? new ScriptedNetwork(Clock);
            Settings = settings ?? OccAirPictureHandlerTests.Settings();
            Picture = new AirPictureService(provider ?? Network, Settings, Clock);
        }

        public ManualClock Clock { get; } = new(Now);

        public ScriptedNetwork Network { get; }

        public AirTrafficSettings Settings { get; }

        public AirPictureService Picture { get; }

        public KeyStore Keys { get; } = new();

        /// <summary>How many times a handler asked who the actor is.</summary>
        public int Resolutions => _resolutions;

        public GetOccAirPictureHandler AirPicture(ActorContext? actor) =>
            new(new Resolver(actor, () => _resolutions++), Picture, Keys, Settings, Clock);

        public GetOccAircraftTrackHandler Track(ActorContext? actor) =>
            new(new Resolver(actor, () => _resolutions++), Picture, Settings);

        /// <summary>A screen watches and one read of the network brings <paramref name="aircraft"/>, placed now.</summary>
        public async Task ReadNetworkAsync(params AirTrafficAircraft[] aircraft)
        {
            Network.Aircraft = [.. aircraft.Select(item => item with { PositionAt = Clock.GetUtcNow() })];
            Picture.NoteDemand();
            var reads = Network.Reads;
            await Picture.PollOnceAsync(Ct);
            Assert.Equal(reads + 1, Network.Reads);
        }
    }

    private sealed class Resolver(ActorContext? actor, Action resolved) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default)
        {
            resolved();
            return Task.FromResult(actor);
        }
    }

    /// <summary>The flights to match, and who asked for them.</summary>
    private sealed class KeyStore : IOccMapFlightMatchKeyStore
    {
        public IReadOnlyList<MapFlightMatchKey> Keys { get; set; } = [];

        public Exception? Failure { get; set; }

        public List<(Guid StationId, DateTimeOffset Now)> Requests { get; } = [];

        public int Calls => Requests.Count;

        public Task<IReadOnlyList<MapFlightMatchKey>> ListMatchKeysAsync(Guid stationId, DateTimeOffset now,
            CancellationToken cancellationToken = default)
        {
            Requests.Add((stationId, now));
            return Failure is null ? Task.FromResult(Keys) : Task.FromException<IReadOnlyList<MapFlightMatchKey>>(Failure);
        }
    }

    private sealed class ScriptedNetwork(TimeProvider clock) : IAirTrafficProvider
    {
        public AirTrafficOutcome Outcome { get; set; } = AirTrafficOutcome.Succeeded;

        public IReadOnlyList<AirTrafficAircraft> Aircraft { get; set; } = [];

        public int Reads { get; private set; }

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution => Credit;

        public Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Reads++;
            return Task.FromResult(Outcome == AirTrafficOutcome.Succeeded
                ? new AirTrafficReadResult(Outcome, Credit, clock.GetUtcNow(), [.. Aircraft], null)
                : AirTrafficReadResult.Failure(Outcome, Credit));
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private long _ticks = start.UtcTicks;

        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref _ticks), TimeSpan.Zero);

        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);
    }
}
