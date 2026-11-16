using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>«Por facturar» (4-N16): the query, its opaque cursor and who may read it.</summary>
public sealed class GetFinancePendingOperationsHandlerTests
{
    private static readonly Guid Account = Guid.NewGuid();
    private static readonly Guid Station = Guid.NewGuid();

    [Fact]
    public async Task ValidatesThePageThePeriodAndTheCursorBeforeTheStore()
    {
        var store = new Store();
        var handler = new GetFinancePendingOperationsHandler(new Resolver(Actor("finance.invoicing.read", Station)), store);
        var ct = TestContext.Current.CancellationToken;
        var day = new DateOnly(2026, 11, 7);
        foreach (var query in new[]
                 {
                     Query() with { StationId = Guid.Empty }, Query() with { Limit = 0 }, Query() with { Limit = 101 },
                     Query() with { From = day, To = day.AddDays(-1) }, Query() with { AirlineId = Guid.Empty },
                     Query() with { Cursor = "not a cursor" }, Query() with { Cursor = "YWJj" },
                 })
            Assert.Equal(FinancePendingOperationsFailure.InvalidRequest, (await handler.HandleAsync(query, ct)).Failure);
        Assert.Null(store.Query);

        var cursor = new FinancePendingKey(day, "DEV-TAT-0001", Guid.NewGuid()).Encode();
        var valid = Query() with { From = day.AddDays(-40), To = day, Cursor = cursor, Limit = 100 };
        Assert.True((await handler.HandleAsync(valid, ct)).IsSuccess);
        Assert.Equal(valid, store.Query);
        Assert.Equal(50, Query().Limit);
    }

    [Fact]
    public async Task RequiresInvoicingAccessAndTheStationScope()
    {
        var ct = TestContext.Current.CancellationToken;
        Assert.Equal(FinancePendingOperationsFailure.Unauthorized, (await new GetFinancePendingOperationsHandler(
            new Resolver(null), new Store()).HandleAsync(Query(), ct)).Failure);
        Assert.Equal(FinancePendingOperationsFailure.Forbidden, (await new GetFinancePendingOperationsHandler(
            new Resolver(Actor("finance.receipts.read", Station)), new Store()).HandleAsync(Query(), ct)).Failure);
        Assert.Equal(FinancePendingOperationsFailure.NotFound, (await new GetFinancePendingOperationsHandler(
            new Resolver(Actor("finance.invoicing.read", Guid.NewGuid())), new Store()).HandleAsync(Query(), ct)).Failure);
        Assert.Equal(FinancePendingOperationsFailure.NotFound, (await new GetFinancePendingOperationsHandler(
            new Resolver(Actor("finance.invoicing.read", Station)), new Store { Empty = true }).HandleAsync(Query(), ct)).Failure);
    }

    [Fact]
    public void TheCursorRoundTripsAndOrdersByDateCodeAndId()
    {
        var id = Guid.Parse("01890000-0000-7000-8000-000000000001");
        var key = new FinancePendingKey(new DateOnly(2026, 11, 3), "DEV|TAT-0007", id);
        var cursor = key.Encode();
        Assert.Matches("^[A-Za-z0-9_-]+$", cursor);
        Assert.True(FinancePendingKey.TryDecode(cursor, out var decoded));
        Assert.Equal(key, decoded);
        Assert.False(FinancePendingKey.TryDecode("", out _));
        Assert.False(FinancePendingKey.TryDecode("a+b", out _));

        var earlier = key with { OperationDate = key.OperationDate.AddDays(-1), OperationCode = "ZZZ" };
        var sameDay = key with { OperationCode = "DEV|TAT-0008" };
        var sameCode = key with { OperationId = Guid.Parse("01890000-0000-7000-8000-000000000002") };
        Assert.Equal([earlier, key, sameCode, sameDay], new[] { sameDay, sameCode, key, earlier }.Order().ToArray());
    }

    private static GetFinancePendingOperationsQuery Query() => new(Account, Station, null, null, null, null);

    private static ActorContext Actor(string permission, Guid station) =>
        new(Account, "finance@dev.elevant.test", "Finance",
            [new ActorRole(Guid.NewGuid(), "FINANZAS", "FINANZAS", PortalKind.BackOffice, "staff")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(station, "PUJ")],
            new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance, new HashSet<string> { permission }));

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    private sealed class Store : IFinancePendingOperationsReadStore
    {
        public GetFinancePendingOperationsQuery? Query { get; private set; }

        public bool Empty { get; init; }

        public Task<FinancePendingOperationsData?> GetAsync(GetFinancePendingOperationsQuery query,
            CancellationToken cancellationToken = default)
        {
            Query = query;
            return Task.FromResult(Empty ? null : new FinancePendingOperationsData(query.StationId, [], [], null, 0));
        }

        public Task<int?> CountAsync(Guid accountId, Guid stationId, CancellationToken cancellationToken = default) =>
            Task.FromResult<int?>(0);
    }
}
