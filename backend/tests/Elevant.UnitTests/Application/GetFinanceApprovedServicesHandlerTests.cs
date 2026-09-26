using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class GetFinanceApprovedServicesHandlerTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000001");
    private static readonly DateOnly From = new(2026, 9, 1);
    private static readonly DateOnly To = new(2026, 9, 26);

    [Fact]
    public async Task FinanceReadsOnlyItsLiveStationWindow()
    {
        var store = new StubStore { Value = new FinanceApprovedServicesData(StationId, From, To, [], false) };
        var result = await new GetFinanceApprovedServicesHandler(new Resolver(Actor()), store)
            .HandleAsync(new(AccountId, StationId, From, To), TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal((AccountId, StationId, From, To), store.LastRequest);
    }

    [Theory]
    [InlineData("unknown", FinanceApprovedServicesFailure.Unauthorized)]
    [InlineData("occ-role", FinanceApprovedServicesFailure.Forbidden)]
    [InlineData("airline-membership", FinanceApprovedServicesFailure.Forbidden)]
    [InlineData("other-station", FinanceApprovedServicesFailure.NotFound)]
    [InlineData("long-window", FinanceApprovedServicesFailure.InvalidRequest)]
    public async Task RejectsWithoutQueryingStore(string scenario, FinanceApprovedServicesFailure expected)
    {
        var actor = Actor();
        var query = new GetFinanceApprovedServicesQuery(AccountId, StationId, From, To);
        switch (scenario)
        {
            case "unknown": actor = null; break;
            case "occ-role": actor = actor with { Roles = [actor.Roles[0] with { Code = "ADMIN_OCC" }] }; break;
            case "airline-membership": actor = actor with { Memberships = [actor.Memberships[0] with { Kind = MembershipKind.AirlineClient }] }; break;
            case "other-station": query = query with { StationId = Guid.NewGuid() }; break;
            case "long-window": query = query with { To = To.AddDays(20) }; break;
        }
        var store = new StubStore();
        var result = await new GetFinanceApprovedServicesHandler(new Resolver(actor), store)
            .HandleAsync(query, TestContext.Current.CancellationToken);

        Assert.Equal(expected, result.Failure);
        Assert.Null(store.LastRequest);
    }

    private static ActorContext Actor() => new(
        AccountId, "finance@dev.elevant.test", "Finance Tester",
        [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    private sealed class StubStore : IFinanceApprovedServicesReadStore
    {
        public (Guid AccountId, Guid StationId, DateOnly From, DateOnly To)? LastRequest { get; private set; }
        public FinanceApprovedServicesData? Value { get; init; }

        public Task<FinanceApprovedServicesData?> GetAsync(
            Guid accountId, Guid stationId, DateOnly from, DateOnly to,
            CancellationToken cancellationToken = default)
        {
            LastRequest = (accountId, stationId, from, to);
            return Task.FromResult(Value);
        }
    }
}
