using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class AirlinePortalBootstrapHandlerTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000003");
    private static readonly Guid OrganizationId = Guid.Parse("10000000-0000-7000-8000-000000000002");
    private static readonly Guid AirlineId = Guid.Parse("20000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");

    [Fact]
    public async Task AirlineClientSeesOnlyServerResolvedTenantAndContractStations()
    {
        var store = new StubStore(new AirlinePortalBootstrapData(
            AirlineId,
            OrganizationId,
            "ZZ",
            "DVA",
            "Demo Airlines",
            [new AirlinePortalStationData(StationId, "PUJ", "Punta Cana", "America/Santo_Domingo")]));
        var handler = CreateHandler(CreateActor(), store);

        var result = await handler.HandleAsync(AccountId, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(OrganizationId, store.QueriedOrganizationId);
        Assert.Equal(new DateOnly(2026, 9, 25), store.QueriedDate);
        Assert.Equal("PUJ", Assert.Single(result.Bootstrap!.Stations).Code);
    }

    [Fact]
    public async Task OccAccountCannotReadAnAirlineTenant()
    {
        var actor = CreateActor() with
        {
            Roles = [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "admin_occ")],
        };
        var store = new StubStore(null);
        var result = await CreateHandler(actor, store).HandleAsync(AccountId, TestContext.Current.CancellationToken);

        Assert.Equal(AirlinePortalFailure.Forbidden, result.Failure);
        Assert.Null(store.QueriedOrganizationId);
    }

    [Fact]
    public async Task MultipleAirlineMembershipsAreNotSilentlyCombined()
    {
        var actor = CreateActor() with
        {
            Memberships =
            [
                CreateActor().Memberships[0],
                new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "OTHER", "Other airline",
                    OrganizationType.AirlineCustomer, MembershipKind.AirlineClient),
            ],
        };
        var store = new StubStore(null);
        var result = await CreateHandler(actor, store).HandleAsync(AccountId, TestContext.Current.CancellationToken);

        Assert.Equal(AirlinePortalFailure.Forbidden, result.Failure);
        Assert.Null(store.QueriedOrganizationId);
    }

    [Fact]
    public async Task MismatchedReadStoreTenantFailsClosed()
    {
        var store = new StubStore(new AirlinePortalBootstrapData(
            AirlineId, Guid.NewGuid(), "ZZ", "DVA", "Wrong airline", []));
        var result = await CreateHandler(CreateActor(), store)
            .HandleAsync(AccountId, TestContext.Current.CancellationToken);

        Assert.Equal(AirlinePortalFailure.NotFound, result.Failure);
        Assert.Null(result.Bootstrap);
    }

    [Fact]
    public async Task EmptySubjectDoesNotReachTheStore()
    {
        var store = new StubStore(null);
        var result = await CreateHandler(CreateActor(), store)
            .HandleAsync(Guid.Empty, TestContext.Current.CancellationToken);

        Assert.Equal(AirlinePortalFailure.Unauthorized, result.Failure);
        Assert.Null(store.QueriedOrganizationId);
    }

    private static GetAirlinePortalBootstrapHandler CreateHandler(ActorContext actor, StubStore store) =>
        new(new StubResolver(actor), store,
            new FixedTimeProvider(new DateTimeOffset(2026, 9, 25, 12, 0, 0, TimeSpan.Zero)));

    private static ActorContext CreateActor() => new(
        AccountId,
        "airline.client@dev.elevant.test",
        "Airline Client",
        [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline Client", PortalKind.AirlinePortal, "airline_client")],
        [new ActorMembership(Guid.NewGuid(), OrganizationId, "DEMO-AIR", "Demo Airlines",
            OrganizationType.AirlineCustomer, MembershipKind.AirlineClient)],
        []);

    private sealed class StubResolver(ActorContext actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(actor);
    }

    private sealed class StubStore(AirlinePortalBootstrapData? bootstrap) : IAirlinePortalReadStore
    {
        public Guid? QueriedOrganizationId { get; private set; }

        public DateOnly? QueriedDate { get; private set; }

        public Task<AirlinePortalBootstrapData?> GetBootstrapAsync(
            Guid organizationId,
            DateOnly onDate,
            CancellationToken cancellationToken = default)
        {
            QueriedOrganizationId = organizationId;
            QueriedDate = onDate;
            return Task.FromResult(bootstrap);
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
