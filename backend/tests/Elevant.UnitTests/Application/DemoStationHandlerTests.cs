using Elevant.Application;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations.DemoStation;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041, contracts 1.2: «Cargar posiciones de Punta Cana» belongs to the superadministrator and to the environments
/// that turn demo flights on (<c>DemoFlights:Mode</c>). The handler refuses everything else before the store is
/// reached, in the order the demo flights refuse it.
/// </summary>
public sealed class DemoStationHandlerTests
{
    private static readonly Guid Station = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid Key = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-000000000002");

    private static readonly ActorContext OccAdministrator = IdentityTestData.CreateActor();

    private static readonly ActorContext Superadministrator = OccAdministrator with
    {
        Roles = [OccAdministrator.Roles[0] with { Code = "SUPERADMIN", Name = "Superadmin", UserType = "superadmin" }],
        StationScopes = [],
    };

    private static DemoStationHandler Handler(Store store, ActorContext? actor, DemoFlightAvailability availability) =>
        new(store, new Resolver(actor), availability);

    private static void AssertRefused(MasterDataResult<DemoStationLayoutData> result, MasterDataFailure failure, string code)
    {
        Assert.Null(result.Value);
        Assert.Equal((failure, code), (result.Failure, result.Code));
    }

    [Fact]
    public async Task OnlyTheSuperadministratorLoadsTheStands()
    {
        var store = new Store();
        var ct = TestContext.Current.CancellationToken;

        foreach (var other in new[] { OccAdministrator, IdentityTestData.CreateAirlineActor(), null })
            AssertRefused(await Handler(store, other, DemoFlightAvailability.On)
                .PrepareAsync(IdentityTestData.AccountId, Station, Key, ct), MasterDataFailure.Forbidden, "forbidden");
        // A request without an account is nobody, whatever the resolver would answer.
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.On);
        AssertRefused(await handler.PrepareAsync(Guid.Empty, Station, Key, ct), MasterDataFailure.Forbidden, "forbidden");
        Assert.Empty(store.Calls);

        var prepared = await handler.PrepareAsync(IdentityTestData.AccountId, Station, Key, ct);
        Assert.Same(Store.Answer, prepared);
        Assert.Equal([$"prepare {IdentityTestData.AccountId} {Station} {Key}"], store.Calls);
    }

    [Fact]
    public async Task ADisabledEnvironmentAnswersUnavailableBeforeTheStore()
    {
        var store = new Store();
        var ct = TestContext.Current.CancellationToken;
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.Disabled);

        AssertRefused(await handler.PrepareAsync(IdentityTestData.AccountId, Station, Key, ct), MasterDataFailure.Conflict,
            "demo_flights_unavailable");
        // Unavailable comes first: a missing key or station is not even looked at.
        AssertRefused(await handler.PrepareAsync(IdentityTestData.AccountId, Guid.Empty, Guid.Empty, ct),
            MasterDataFailure.Conflict, "demo_flights_unavailable");
        // Anyone else learns nothing, not even that the feature is off.
        AssertRefused(await Handler(store, OccAdministrator, DemoFlightAvailability.Disabled)
            .PrepareAsync(IdentityTestData.AccountId, Station, Key, ct), MasterDataFailure.Forbidden, "forbidden");
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task TheKeyIsAskedForBeforeTheStore()
    {
        var store = new Store();
        var ct = TestContext.Current.CancellationToken;
        var handler = Handler(store, Superadministrator, DemoFlightAvailability.On);

        AssertRefused(await handler.PrepareAsync(IdentityTestData.AccountId, Station, Guid.Empty, ct),
            MasterDataFailure.Invalid, "idempotency_key_required");
        // Before the station, as every master-data command asks for it.
        AssertRefused(await handler.PrepareAsync(IdentityTestData.AccountId, Guid.Empty, Guid.Empty, ct),
            MasterDataFailure.Invalid, "idempotency_key_required");
        Assert.Empty(store.Calls);
    }

    [Fact]
    public async Task AnEmptyStationIsUnavailable()
    {
        var store = new Store();
        var ct = TestContext.Current.CancellationToken;

        AssertRefused(await Handler(store, Superadministrator, DemoFlightAvailability.On)
                .PrepareAsync(IdentityTestData.AccountId, Guid.Empty, Key, ct), MasterDataFailure.NotFound,
            "station_unavailable");
        Assert.Empty(store.Calls);
    }

    /// <summary>The application registers the handler; the store of the persistence layer answers it.</summary>
    [Fact]
    public void TheApplicationRegistersTheHandler()
    {
        var registered = Assert.Single(new ServiceCollection().AddApplication(),
            item => item.ServiceType == typeof(DemoStationHandler));
        Assert.Equal(ServiceLifetime.Scoped, registered.Lifetime);
    }

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    /// <summary>What the store answers when it is reached, and what reached it.</summary>
    private sealed class Store : IDemoStationStore
    {
        public static readonly MasterDataResult<DemoStationLayoutData> Answer = MasterDataResult<DemoStationLayoutData>.Success(
            new DemoStationLayoutData(Station, "PUJ", true, 3, 3, 41, 41, 43, 41, [], ["B01", "B02"], true));

        public List<string> Calls { get; } = [];

        public Task<MasterDataResult<DemoStationLayoutData>> PrepareAsync(Guid actorId, Guid stationId, Guid idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            Calls.Add($"prepare {actorId} {stationId} {idempotencyKey}");
            return Task.FromResult(Answer);
        }
    }
}
