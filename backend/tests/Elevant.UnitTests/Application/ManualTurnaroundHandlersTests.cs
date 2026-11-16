using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Application.Operations.CreateManualTurnaround;
using Elevant.Application.Operations.GetManualTurnaroundOptions;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class ManualTurnaroundHandlersTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid AirlineId = Guid.Parse("10000000-0000-7000-8000-000000000004");
    private static readonly Guid StandId = Guid.Parse("20000000-0000-7000-8000-000000000005");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000099");
    private static readonly DateOnly Date = new(2026, 9, 26);

    [Fact]
    public async Task CreatePassesOnlyAuthorizedStationScopeAndNormalizedPayload()
    {
        var store = new StubStore { CreateResult = ManualTurnaroundWriteResult.Created(TurnaroundId, "MAN-TEST") };
        var handler = new CreateManualTurnaroundHandler(new ActorResolver(CreateActor()), store);

        var result = await handler.HandleAsync(CreateCommand() with
        {
            ArrivalFlightNumber = " ev 311 ",
            ArrivalOriginIata = " jfk ",
            DepartureFlightNumber = " ev 312 ",
            DepartureDestinationIata = " mia ",
        }, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(StationId, store.Received!.StationId);
        Assert.Equal(StandId, store.Received.StandId);
        Assert.Equal([StationId], store.Received.AllowedStationIds);
        Assert.Equal("EV311", store.Received.ArrivalFlightNumber);
        Assert.Equal("JFK", store.Received.ArrivalOriginIata);
        Assert.Equal("EV312", store.Received.DepartureFlightNumber);
        Assert.Equal("MIA", store.Received.DepartureDestinationIata);
    }

    [Theory]
    [InlineData("foreign-station", OccPlanningFailure.NotFound)]
    [InlineData("wrong-role", OccPlanningFailure.Forbidden)]
    [InlineData("wrong-membership", OccPlanningFailure.Forbidden)]
    [InlineData("missing-actor", OccPlanningFailure.Unauthorized)]
    public async Task AuthorizationFailsBeforePersistence(string scenario, OccPlanningFailure failure)
    {
        var actor = CreateActor();
        var command = CreateCommand();
        actor = scenario switch
        {
            "wrong-role" => actor with { Roles = [actor.Roles[0] with { Code = "CONTRACTS" }] },
            "wrong-membership" => actor with { Memberships = [actor.Memberships[0] with { Kind = MembershipKind.AirlineClient }] },
            "missing-actor" => null,
            _ => actor,
        };
        if (scenario == "foreign-station")
            command = command with { StationId = Guid.NewGuid() };
        var store = new StubStore();
        var result = await new CreateManualTurnaroundHandler(new ActorResolver(actor), store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.Equal(failure, result.Failure);
        Assert.Null(store.Received);
    }

    [Theory]
    [InlineData("empty-id")]
    [InlineData("same-airport")]
    [InlineData("inverted-time")]
    [InlineData("non-utc")]
    [InlineData("invalid-flight")]
    [InlineData("invalid-iata")]
    public async Task InvalidRequestFailsBeforePersistence(string scenario)
    {
        var command = CreateCommand();
        command = scenario switch
        {
            "empty-id" => command with { TurnaroundId = Guid.Empty },
            "same-airport" => command with { ArrivalOriginIata = "PUJ" },
            "inverted-time" => command with { DepartureScheduledAt = command.ArrivalScheduledAt },
            "non-utc" => command with { ArrivalScheduledAt = command.ArrivalScheduledAt.ToOffset(TimeSpan.FromHours(-4)) },
            "invalid-flight" => command with { ArrivalFlightNumber = "%%%" },
            "invalid-iata" => command with { DepartureDestinationIata = "AB12" },
            _ => command,
        };
        var store = new StubStore();
        var result = await new CreateManualTurnaroundHandler(new ActorResolver(CreateActor()), store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Received);
    }

    [Theory]
    [InlineData(ManualTurnaroundWriteFailure.NotFound, OccPlanningFailure.NotFound)]
    [InlineData(ManualTurnaroundWriteFailure.Conflict, OccPlanningFailure.Conflict)]
    public async Task StoreFailuresAreMapped(ManualTurnaroundWriteFailure source, OccPlanningFailure expected)
    {
        var store = new StubStore { CreateResult = ManualTurnaroundWriteResult.Failed(source) };
        var result = await new CreateManualTurnaroundHandler(new ActorResolver(CreateActor()), store)
            .HandleAsync(CreateCommand(), TestContext.Current.CancellationToken);

        Assert.Equal(expected, result.Failure);
    }

    [Fact]
    public async Task ManualOptionsAreScopedToOneOccStation()
    {
        var store = new StubOptionsStore
        {
            Options = new ManualTurnaroundOptionsData(
                new OccStationData(StationId, "PUJ", "Punta Cana", "America/Santo_Domingo"),
                Date,
                new OccAirportData(Guid.NewGuid(), "PUJ", "MDPC", "Punta Cana"),
                [], [], []),
        };
        var result = await new GetManualTurnaroundOptionsHandler(
                new ActorResolver(CreateActor()), store)
            .HandleAsync(new GetManualTurnaroundOptionsQuery(AccountId, StationId, Date),
                TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal((AccountId, StationId, Date), store.Received);
    }

    [Fact]
    public async Task ManualOptionsRejectOutOfScopeStationBeforeQuery()
    {
        var store = new StubOptionsStore();
        var result = await new GetManualTurnaroundOptionsHandler(
                new ActorResolver(CreateActor()), store)
            .HandleAsync(new GetManualTurnaroundOptionsQuery(AccountId, Guid.NewGuid(), Date),
                TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.NotFound, result.Failure);
        Assert.Null(store.Received);
    }

    private static CreateManualTurnaroundCommand CreateCommand() => new(
        AccountId, TurnaroundId, StationId, AirlineId, StandId, Date,
        "EV311", "JFK", new DateTimeOffset(2026, 9, 26, 13, 0, 0, TimeSpan.Zero),
        "EV312", "MIA", new DateTimeOffset(2026, 9, 26, 15, 0, 0, TimeSpan.Zero),
        Guid.NewGuid(), "unit-test");

    private static ActorContext CreateActor() => new(
        AccountId, "occ@dev.elevant.test", "OCC Tester",
        [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "admin_occ")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

    private sealed class ActorResolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    private sealed class StubStore : IManualTurnaroundStore
    {
        public ManualTurnaroundWriteRequest? Received { get; private set; }
        public ManualTurnaroundWriteResult CreateResult { get; init; } =
            ManualTurnaroundWriteResult.Created(TurnaroundId, "MAN-TEST");

        public Task<ManualTurnaroundWriteResult> CreateAsync(
            ManualTurnaroundWriteRequest request, CancellationToken cancellationToken = default)
        {
            Received = request;
            return Task.FromResult(CreateResult);
        }
    }

    private sealed class StubOptionsStore : IManualTurnaroundOptionsStore
    {
        public ManualTurnaroundOptionsData? Options { get; init; }
        public (Guid AccountId, Guid StationId, DateOnly Date)? Received { get; private set; }

        public Task<ManualTurnaroundOptionsData?> GetAsync(
            Guid accountId, Guid stationId, DateOnly operationDate,
            CancellationToken cancellationToken = default)
        {
            Received = (accountId, stationId, operationDate);
            return Task.FromResult(Options);
        }
    }
}
