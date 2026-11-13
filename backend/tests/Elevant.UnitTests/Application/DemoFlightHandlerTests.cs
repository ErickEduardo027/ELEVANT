using Elevant.Application;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Integration.DemoFlights;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041: demo flights belong to the superadministrator and to the environments that turn them on
/// (<c>DemoFlights:Mode</c>). The handler refuses everything else before the store is reached.
/// </summary>
public sealed class DemoFlightHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 14, 0, 0, TimeSpan.Zero);
    private static readonly Guid Station = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid Airline = Guid.Parse("21000000-0000-7000-8000-000000000001");
    private static readonly Guid AircraftType = Guid.Parse("22000000-0000-7000-8000-000000000001");
    private static readonly Guid Stand = Guid.Parse("23000000-0000-7000-8000-000000000001");
    private static readonly Guid DemoFlight = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a");
    private static readonly Guid Key = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-000000000001");

    private static readonly ActorContext OccAdministrator = IdentityTestData.CreateActor();

    private static readonly ActorContext Superadministrator = OccAdministrator with
    {
        Roles = [OccAdministrator.Roles[0] with { Code = "SUPERADMIN", Name = "Superadmin", UserType = "superadmin" }],
        StationScopes = [],
    };

    /// <summary>The options for an aircraft of that type that parks in 15 minutes for two hours.</summary>
    private static readonly DemoFlightOptionsQuery Query = new(Station, AircraftType, 15, 120);

    private static CreateDemoFlightCommand Command(int minutes = 8) =>
        new(Station, Airline, " mia ", null, AircraftType, "None", null, minutes, 60);

    private static DemoFlightHandler Handler(Store store, ActorContext? actor, DemoFlightAvailability availability) =>
        new(store, new Resolver(actor), availability, new FixedTime(Now));

    private static void AssertRefused(MasterDataResult<DemoFlightData> result, MasterDataFailure failure, string code)
    {
        Assert.Null(result.Value);
        Assert.Equal(failure, result.Failure);
        Assert.Equal(code, result.Code);
    }

    [Fact]
    public async Task ADisabledEnvironmentAnswersUnavailableBeforeTheStore()
    {
        var store = new Store();
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.Disabled);
        var ct = TestContext.Current.CancellationToken;

        AssertRefused(await handler.CreateAsync(IdentityTestData.AccountId, Command(), Key, ct),
            MasterDataFailure.Conflict, "demo_flights_unavailable");
        AssertRefused(await handler.CancelAsync(IdentityTestData.AccountId, DemoFlight, "Cancel", Key, ct),
            MasterDataFailure.Conflict, "demo_flights_unavailable");
        // Unavailable comes first: an invalid request or a missing key is not even looked at.
        AssertRefused(await handler.CreateAsync(IdentityTestData.AccountId, Command(minutes: 99), Guid.Empty, ct),
            MasterDataFailure.Conflict, "demo_flights_unavailable");
        AssertRefused(await handler.CancelAsync(IdentityTestData.AccountId, DemoFlight, "Dismiss", Guid.Empty, ct),
            MasterDataFailure.Conflict, "demo_flights_unavailable");
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task OptionsSayDisabledOnlyToTheSuperadministrator()
    {
        var store = new Store();
        var ct = TestContext.Current.CancellationToken;

        var handler = Handler(store, Superadministrator, DemoFlightAvailability.Disabled);
        var options = await handler.OptionsAsync(IdentityTestData.AccountId, Query, ct);
        Assert.NotNull(options);
        Assert.False(options.Enabled);
        Assert.Equal(Now, options.ServerTime);
        Assert.Null(options.StationId);
        Assert.Null(options.OperationDate);
        Assert.Empty(options.Stations);
        Assert.Empty(options.Airlines);
        Assert.Empty(options.Airports);
        Assert.Empty(options.AircraftTypes);
        Assert.Empty(options.Stands);
        Assert.Empty(options.Warnings);
        Assert.Null(options.Layout);
        // The form's limits: 2 to 30 minutes to the stand (8 by default), 20 to 240 on the ground (60), 3 at a time.
        Assert.Equal(new DemoFlightLimitsData(2, 30, 8, 20, 240, 60, 3, 0), options.Limits);

        var list = await handler.ListAsync(IdentityTestData.AccountId, Station, ct);
        Assert.NotNull(list);
        Assert.False(list.Enabled);
        Assert.Equal(Now, list.ServerTime);
        Assert.Null(list.StationId);
        Assert.Empty(list.Flights);

        // Anyone else learns nothing, not even that the feature is off.
        foreach (var other in new[] { OccAdministrator, IdentityTestData.CreateAirlineActor(), null })
        {
            var refused = Handler(store, other, DemoFlightAvailability.Disabled);
            Assert.Null(await refused.OptionsAsync(IdentityTestData.AccountId, Query, ct));
            Assert.Null(await refused.ListAsync(IdentityTestData.AccountId, Station, ct));
            AssertRefused(await refused.CreateAsync(IdentityTestData.AccountId, Command(), Key, ct),
                MasterDataFailure.Forbidden, "forbidden");
            AssertRefused(await refused.CancelAsync(IdentityTestData.AccountId, DemoFlight, "Cancel", Key, ct),
                MasterDataFailure.Forbidden, "forbidden");
        }
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task OnlyTheSuperadministratorReachesTheStoreWhenDemoFlightsAreOn()
    {
        var store = new Store();
        var ct = TestContext.Current.CancellationToken;

        foreach (var other in new[] { OccAdministrator, IdentityTestData.CreateAirlineActor(), null })
        {
            var refused = Handler(store, other, DemoFlightAvailability.On);
            Assert.Null(await refused.OptionsAsync(IdentityTestData.AccountId, Query, ct));
            Assert.Null(await refused.ListAsync(IdentityTestData.AccountId, null, ct));
            AssertRefused(await refused.CreateAsync(IdentityTestData.AccountId, Command(), Key, ct),
                MasterDataFailure.Forbidden, "forbidden");
            AssertRefused(await refused.CancelAsync(IdentityTestData.AccountId, DemoFlight, "Finish", Key, ct),
                MasterDataFailure.Forbidden, "forbidden");
        }
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.On);
        // A request without an account is nobody, whatever the resolver would answer.
        Assert.Null(await handler.OptionsAsync(Guid.Empty, Query, ct));
        AssertRefused(await handler.CreateAsync(Guid.Empty, Command(), Key, ct), MasterDataFailure.Forbidden, "forbidden");
        Assert.Empty(store.Calls);

        Assert.Same(Store.Options, await handler.OptionsAsync(IdentityTestData.AccountId, Query, ct));
        Assert.Same(Store.List, await handler.ListAsync(IdentityTestData.AccountId, null, ct));
        Assert.Equal([$"options {IdentityTestData.AccountId} {Station}", $"list {IdentityTestData.AccountId} any"],
            store.Calls);
        // The visit the form asks about reaches the store as it is: the stands are evaluated for it.
        Assert.Same(Query, store.Asked);
    }

    [Fact]
    public async Task AnInvalidRequestNeverReachesTheStore()
    {
        var store = new Store();
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.On);
        var ct = TestContext.Current.CancellationToken;

        AssertRefused(await handler.CreateAsync(IdentityTestData.AccountId, Command(minutes: 1), Key, ct),
            MasterDataFailure.Invalid, "invalid_demo_flight");
        // «Al azar» draws its own stand: a request that names one breaks the rule.
        var randomWithStand = Command() with { StandChoice = "Random", StandId = Stand };
        AssertRefused(await handler.CreateAsync(IdentityTestData.AccountId, randomWithStand, Key, ct),
            MasterDataFailure.Invalid, "invalid_demo_flight");
        AssertRefused(await handler.CancelAsync(IdentityTestData.AccountId, DemoFlight, "cancel", Key, ct),
            MasterDataFailure.Invalid, "invalid_demo_flight");
        AssertRefused(await handler.CancelAsync(IdentityTestData.AccountId, DemoFlight, null, Key, ct),
            MasterDataFailure.Invalid, "invalid_demo_flight");
        AssertRefused(await handler.CancelAsync(IdentityTestData.AccountId, Guid.Empty, "Cancel", Key, ct),
            MasterDataFailure.Invalid, "invalid_demo_flight");
        // The key is asked for before the request is read, as every master-data command does.
        AssertRefused(await handler.CreateAsync(IdentityTestData.AccountId, Command(minutes: 1), Guid.Empty, ct),
            MasterDataFailure.Invalid, "idempotency_key_required");
        AssertRefused(await handler.CancelAsync(IdentityTestData.AccountId, DemoFlight, "Finish", Guid.Empty, ct),
            MasterDataFailure.Invalid, "idempotency_key_required");
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task AValidRequestReachesTheStoreNormalizedWithItsKey()
    {
        var store = new Store();
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.On);
        var ct = TestContext.Current.CancellationToken;

        var created = await handler.CreateAsync(IdentityTestData.AccountId, Command(), Key, ct);
        Assert.Same(Store.Flight, created.Value);
        Assert.Equal(
            new CreateDemoFlightInput(Station, Airline, "MIA", "MIA", AircraftType, DemoStandChoice.None, null, 8, 60),
            store.Created);

        var finished = await handler.CancelAsync(IdentityTestData.AccountId, DemoFlight, "Finish", Key, ct);
        Assert.Same(Store.Flight, finished.Value);
        Assert.Equal((DemoFlight, DemoFlightIntent.Finish), store.Cancelled);
        Assert.Equal([$"create {IdentityTestData.AccountId} {Key}", $"cancel {IdentityTestData.AccountId} {Key}"],
            store.Calls);
    }

    [Fact]
    public async Task ARandomStandChoiceReachesTheStoreWithoutAStand()
    {
        var store = new Store();
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.On);
        var ct = TestContext.Current.CancellationToken;

        var created = await handler.CreateAsync(IdentityTestData.AccountId, Command() with { StandChoice = "Random" }, Key,
            ct);

        // The store draws the stand among the eligible ones with this key as the seed: the request names none.
        Assert.Same(Store.Flight, created.Value);
        Assert.Equal(
            new CreateDemoFlightInput(Station, Airline, "MIA", "MIA", AircraftType, DemoStandChoice.Random, null, 8, 60),
            store.Created);
        Assert.Equal([$"create {IdentityTestData.AccountId} {Key}"], store.Calls);
    }

    /// <summary>
    /// Without Infrastructure (tools, tests) there is no <c>DemoFlights:Mode</c>: demo flights are off, and a host that
    /// already turned them on keeps its choice.
    /// </summary>
    [Fact]
    public void TheApplicationKeepsDemoFlightsOffUnlessTheHostTurnsThemOn()
    {
        var byDefault = Assert.Single(new ServiceCollection().AddApplication(),
            item => item.ServiceType == typeof(DemoFlightAvailability));
        Assert.Same(DemoFlightAvailability.Disabled, byDefault.ImplementationInstance);
        Assert.False(DemoFlightAvailability.Disabled.Enabled);
        Assert.True(DemoFlightAvailability.On.Enabled);

        var turnedOn = Assert.Single(new ServiceCollection().AddSingleton(DemoFlightAvailability.On).AddApplication(),
            item => item.ServiceType == typeof(DemoFlightAvailability));
        Assert.Same(DemoFlightAvailability.On, turnedOn.ImplementationInstance);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    /// <summary>What the store answers when it is reached, and what reached it.</summary>
    private sealed class Store : IDemoFlightStore
    {
        public static readonly DemoFlightOptionsData Options = new(true, Now, [new(Station, "PUJ", "Punta Cana")], Station,
            new DateOnly(2026, 11, 12), [new(Airline, "Demo Airlines", "ZZ", "DZZ")],
            [new("MIA", "KMIA", "Miami International Airport", "Miami", "US")],
            [new(AircraftType, "A320", "Airbus", "A320", "Narrowbody")],
            [new(Stand, "A01", "A", true, true, ["Riley Ramp"], 1, true, [])],
            new DemoFlightLimitsData(2, 30, 8, 20, 240, 60, 3, 1), [new("no_occ_accounts", [])],
            new DemoStationLayoutData(Station, "PUJ", true, 3, 3, 41, 41, 43, 41, [], ["B01", "B02"], true));

        public static readonly DemoFlightData Flight = new(DemoFlight, Station, "PUJ", Airline, "Demo Airlines", "ZZ9001",
            "ZZ9002", "HIDM01", "Airbus A320", "MIA", "MIA", null, "Active", "Approach", Now, Now.AddSeconds(264),
            Now.AddMinutes(8), Now.AddMinutes(68), Now.AddMinutes(68), Now.AddMinutes(73), Now.AddMinutes(83), false, null,
            null, null, null);

        public static readonly DemoFlightListData List = new(true, Now, Station, [Flight]);

        public List<string> Calls { get; } = [];

        public CreateDemoFlightInput? Created { get; private set; }

        public (Guid DemoFlightId, DemoFlightIntent Intent)? Cancelled { get; private set; }

        public DemoFlightOptionsQuery? Asked { get; private set; }

        public Task<DemoFlightOptionsData?> OptionsAsync(Guid actorId, DemoFlightOptionsQuery query,
            CancellationToken cancellationToken = default)
        {
            Calls.Add($"options {actorId} {query.StationId?.ToString() ?? "any"}");
            Asked = query;
            return Task.FromResult<DemoFlightOptionsData?>(Options);
        }

        public Task<DemoFlightListData?> ListAsync(Guid actorId, Guid? stationId, CancellationToken cancellationToken = default)
        {
            Calls.Add($"list {actorId} {stationId?.ToString() ?? "any"}");
            return Task.FromResult<DemoFlightListData?>(List);
        }

        public Task<MasterDataResult<DemoFlightData>> CreateAsync(Guid actorId, CreateDemoFlightInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            Calls.Add($"create {actorId} {idempotencyKey}");
            Created = input;
            return Task.FromResult(MasterDataResult<DemoFlightData>.Success(Flight));
        }

        public Task<MasterDataResult<DemoFlightData>> CancelAsync(Guid actorId, Guid demoFlightId, DemoFlightIntent intent,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            Calls.Add($"cancel {actorId} {idempotencyKey}");
            Cancelled = (demoFlightId, intent);
            return Task.FromResult(MasterDataResult<DemoFlightData>.Success(Flight));
        }

        public Task<int> AdvanceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            Calls.Add("advance");
            return Task.FromResult(0);
        }
    }
}
