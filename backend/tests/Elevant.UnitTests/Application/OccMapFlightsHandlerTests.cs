using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations.AirPicture;
using Elevant.Application.Operations.MapFlights;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0042 (contracts 1.3): the map flights cover two hours back and twelve ahead unless the query says otherwise, from 0
/// to 24 back and from 1 to 36 ahead; any map reader of the station reads them, planning alone too, and any station in
/// scope has them. The store is a stub: nothing reaches a database.
/// </summary>
public sealed class OccMapFlightsHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000043");
    private static readonly Guid PuntaCana = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SantoDomingo = Guid.Parse("20000000-0000-7000-8000-000000000004");

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task TheWindowDefaultsToTwoAndTwelveHoursAndRefusesOutOfRange()
    {
        var store = new Store();
        var resolver = new Resolver(Member("operations.dashboard.read"));
        var handler = new GetOccMapFlightsHandler(resolver, store, new FixedClock(Now));

        // Without a window: two hours back and twelve ahead, resolved at the instant of the request.
        var read = await handler.HandleAsync(AccountId, PuntaCana, null, null, Ct);
        Assert.True(read.IsSuccess);
        Assert.Same(store.Data, read.Value);
        Assert.Equal((PuntaCana, Now.AddHours(-2), Now.AddHours(12), Now), store.Requests[^1]);

        // The limits themselves are accepted; one side alone keeps the default of the other.
        foreach (var (back, ahead, from, to) in new (int?, int?, DateTimeOffset, DateTimeOffset)[]
                 {
                     (0, 1, Now, Now.AddHours(1)), (24, 36, Now.AddHours(-24), Now.AddHours(36)),
                     (6, null, Now.AddHours(-6), Now.AddHours(12)), (null, 3, Now.AddHours(-2), Now.AddHours(3)),
                 })
        {
            Assert.True((await handler.HandleAsync(AccountId, PuntaCana, back, ahead, Ct)).IsSuccess);
            Assert.Equal((PuntaCana, from, to, Now), store.Requests[^1]);
        }

        // Out of range, or no station: invalid before the actor or the store are asked.
        var resolutions = resolver.Calls;
        var requests = store.Requests.Count;
        foreach (var (station, back, ahead) in new (Guid, int?, int?)[]
                 {
                     (PuntaCana, -1, null), (PuntaCana, 25, null), (PuntaCana, null, 0), (PuntaCana, null, 37),
                     (PuntaCana, int.MinValue, int.MaxValue), (Guid.Empty, null, null),
                 })
            Assert.Equal(OccMapFailure.InvalidRequest, (await handler.HandleAsync(AccountId, station, back, ahead, Ct)).Failure);
        Assert.Equal((resolutions, requests), (resolver.Calls, store.Requests.Count));

        // An unknown or inactive station answers no flights: not found.
        store.Data = null;
        Assert.Equal(OccMapFailure.NotFound, (await handler.HandleAsync(AccountId, PuntaCana, null, null, Ct)).Failure);
        Assert.Equal(OccMapFailure.Unauthorized, (await handler.HandleAsync(Guid.Empty, PuntaCana, null, null, Ct)).Failure);
    }

    [Fact]
    public async Task APlanningOnlyReaderCanReadTheFlights()
    {
        var store = new Store();
        var planner = Member("operations.planning.read");
        var read = await new GetOccMapFlightsHandler(new Resolver(planner), store, new FixedClock(Now))
            .HandleAsync(AccountId, PuntaCana, null, null, Ct);
        Assert.True(read.IsSuccess);
        Assert.Single(store.Requests);

        // Any station in scope has map flights, not only the one with live traffic.
        Assert.True((await new GetOccMapFlightsHandler(new Resolver(planner), store, new FixedClock(Now))
            .HandleAsync(AccountId, SantoDomingo, null, null, Ct)).IsSuccess);
        Assert.Equal(SantoDomingo, store.Requests[^1].StationId);

        // Each of the other map permissions too; another permission alone, or none, is forbidden, and so is a reader
        // outside AVIAM's staff. A station outside the scope is not found. None of them reaches the store.
        foreach (var permission in new[] { "operations.dashboard.read", "operations.flight_monitoring.read",
                     "operations.positions_map.read" })
            Assert.True((await new GetOccMapFlightsHandler(new Resolver(Member(permission)), store, new FixedClock(Now))
                .HandleAsync(AccountId, PuntaCana, null, null, Ct)).IsSuccess);
        var requests = store.Requests.Count;
        var airline = planner with
        {
            Memberships = [planner.Memberships[0] with { OrganizationType = OrganizationType.AirlineCustomer,
                Kind = MembershipKind.AirlineClient }],
        };
        foreach (var refused in new[] { Member("operations.review.read"), Member(), airline })
            Assert.Equal(OccMapFailure.Forbidden, (await new GetOccMapFlightsHandler(new Resolver(refused), store,
                new FixedClock(Now)).HandleAsync(AccountId, PuntaCana, null, null, Ct)).Failure);
        Assert.Equal(OccMapFailure.NotFound, (await new GetOccMapFlightsHandler(new Resolver(planner), store,
            new FixedClock(Now)).HandleAsync(AccountId, Guid.Parse("20000000-0000-7000-8000-000000000099"), null, null, Ct))
            .Failure);
        Assert.Equal(OccMapFailure.Unauthorized, (await new GetOccMapFlightsHandler(new Resolver(null), store,
            new FixedClock(Now)).HandleAsync(AccountId, PuntaCana, null, null, Ct)).Failure);
        Assert.Equal(requests, store.Requests.Count);
    }

    /// <summary>AVIAM internal staff of Operations with the given permissions, Punta Cana and Santo Domingo in scope.</summary>
    private static ActorContext Member(params string[] permissions) => new(AccountId, "occ.planner@example.test", "OCC Planner",
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

    /// <summary>Answers the same flights to every station, and records each window it was asked for.</summary>
    private sealed class Store : IOccMapFlightStore
    {
        public OccMapFlightsData? Data { get; set; } = new(PuntaCana, "PUJ", Now, Now.AddHours(-2), Now.AddHours(12),
            new OccMapAirportData("PUJ", "MDPC", "Punta Cana International Airport", 18.567400m, -68.363400m), []);

        public List<(Guid StationId, DateTimeOffset From, DateTimeOffset To, DateTimeOffset Now)> Requests { get; } = [];

        public Task<OccMapFlightsData?> ListAsync(Guid stationId, DateTimeOffset windowFrom, DateTimeOffset windowTo,
            DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            Requests.Add((stationId, windowFrom, windowTo, now));
            return Task.FromResult(Data);
        }
    }

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
