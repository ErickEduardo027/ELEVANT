using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class OccAircraftTrafficHandlerTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");

    [Fact]
    public async Task AuthorizesOnlyInternalOccForExactPujStationBeforeCallingProvider()
    {
        var source = new StubSource();
        var actor = Actor();
        var success = await new GetOccAircraftTrafficHandler(new Resolver(actor), source)
            .HandleAsync(AccountId, StationId);
        Assert.True(success.IsSuccess);
        Assert.Equal(1, source.Calls);

        var otherStation = await new GetOccAircraftTrafficHandler(new Resolver(actor), source)
            .HandleAsync(AccountId, Guid.NewGuid());
        Assert.Equal(OccAircraftTrafficFailure.NotFound, otherStation.Failure);
        Assert.Equal(1, source.Calls);

        var otherRole = actor with { Roles = [actor.Roles[0] with { Code = "CONTRACTS" }] };
        var forbidden = await new GetOccAircraftTrafficHandler(new Resolver(otherRole), source)
            .HandleAsync(AccountId, StationId);
        Assert.Equal(OccAircraftTrafficFailure.Forbidden, forbidden.Failure);
        Assert.Equal(1, source.Calls);

        var otherMembership = actor with { Memberships = [actor.Memberships[0] with { Kind = MembershipKind.AirlineClient }] };
        forbidden = await new GetOccAircraftTrafficHandler(new Resolver(otherMembership), source)
            .HandleAsync(AccountId, StationId);
        Assert.Equal(OccAircraftTrafficFailure.Forbidden, forbidden.Failure);
        Assert.Equal(1, source.Calls);
    }

    [Fact]
    public async Task InvalidAndUnavailableRequestsAreDistinct()
    {
        var source = new StubSource { Data = null };
        var handler = new GetOccAircraftTrafficHandler(new Resolver(Actor()), source);
        Assert.Equal(OccAircraftTrafficFailure.Unauthorized,
            (await handler.HandleAsync(Guid.Empty, StationId)).Failure);
        Assert.Equal(OccAircraftTrafficFailure.InvalidRequest,
            (await handler.HandleAsync(AccountId, Guid.Empty)).Failure);
        Assert.Equal(OccAircraftTrafficFailure.Unavailable,
            (await handler.HandleAsync(AccountId, StationId)).Failure);
        Assert.Equal(1, source.Calls);
    }

    private static ActorContext Actor() => new(
        AccountId, "occ@example.test", "OCC Test",
        [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "admin_occ")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    private sealed class StubSource : IOccAircraftTrafficSource
    {
        public int Calls { get; private set; }
        public OccAircraftTrafficData? Data { get; set; } = new(DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, false, []);
        public Task<OccAircraftTrafficData?> ReadAsync(CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(Data);
        }
    }
}
