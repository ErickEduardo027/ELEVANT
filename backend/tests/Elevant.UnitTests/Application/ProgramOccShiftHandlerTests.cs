using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Application.Operations.ProgramOccShift;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class ProgramOccShiftHandlerTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000099");
    private static readonly Guid AgentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
    private static readonly Guid ShiftId = Guid.Parse("50000000-0000-7000-8000-000000000099");

    [Fact]
    public async Task AuthorizedOccPassesServerDerivedStationAllowlist()
    {
        var store = new StubStore { Response = OccShiftWriteResult.Created(ShiftId) };
        var result = await new ProgramOccShiftHandler(new Resolver(Actor()), store)
            .HandleAsync(Command(), TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.False(result.Replayed);
        Assert.Equal([StationId], store.Request!.AllowedStationIds);
        Assert.Equal(TurnaroundId, store.Request.TurnaroundId);
        Assert.Equal(AgentId, store.Request.AgentId);
    }

    [Theory]
    [InlineData("no-account", OccPlanningFailure.Unauthorized)]
    [InlineData("missing-actor", OccPlanningFailure.Unauthorized)]
    [InlineData("wrong-role", OccPlanningFailure.Forbidden)]
    [InlineData("wrong-membership", OccPlanningFailure.Forbidden)]
    [InlineData("no-station", OccPlanningFailure.NotFound)]
    [InlineData("empty-agent", OccPlanningFailure.InvalidRequest)]
    [InlineData("equal-times", OccPlanningFailure.InvalidRequest)]
    public async Task RejectsInvalidOrUnauthorizedBeforePersistence(string scenario, OccPlanningFailure expected)
    {
        var actor = Actor();
        var command = Command();
        switch (scenario)
        {
            case "no-account": command = command with { AccountId = Guid.Empty }; break;
            case "missing-actor": actor = null; break;
            case "wrong-role": actor = actor with { Roles = [actor.Roles[0] with { Code = "FINANZAS" }] }; break;
            case "wrong-membership": actor = actor with { Memberships = [actor.Memberships[0] with { Kind = MembershipKind.AirlineClient }] }; break;
            case "no-station": actor = actor with { StationScopes = [] }; break;
            case "empty-agent": command = command with { AgentId = Guid.Empty }; break;
            case "equal-times": command = command with { EndsAtLocal = command.StartsAtLocal }; break;
        }
        var store = new StubStore();
        var result = await new ProgramOccShiftHandler(new Resolver(actor), store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.Equal(expected, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task ReturnsReplayedResultWithoutClaimingNewShift()
    {
        var store = new StubStore { Response = OccShiftWriteResult.Existing(ShiftId) };
        var result = await new ProgramOccShiftHandler(new Resolver(Actor()), store)
            .HandleAsync(Command(), TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.True(result.Replayed);
        Assert.Equal(ShiftId, result.ShiftId);
    }

    [Fact]
    public async Task AnotherShiftThatDayIsAConflictTheScreenAdjusts()
    {
        // 3-E: one shift per agent and day; the code tells the screen to offer «Ajustar turno del día».
        var store = new StubStore { Response = OccShiftWriteResult.Failed(OccShiftWriteFailure.Conflict, "shift_day_taken") };
        var result = await new ProgramOccShiftHandler(new Resolver(Actor()), store)
            .HandleAsync(Command(), TestContext.Current.CancellationToken);

        Assert.Equal((OccPlanningFailure.Conflict, "shift_day_taken"), (result.Failure, result.Code));
    }

    [Fact]
    public async Task OccReadsTheAgentsShiftOfTheFlightsDayWithinItsStations()
    {
        var shift = new OccAgentShiftData(ShiftId, AgentId, new DateOnly(2026, 11, 9), new TimeOnly(8, 0),
            new TimeOnly(12, 0), "A", "AAAAAAAAB9E=");
        var store = new StubStore { ShiftResponse = OccAgentShiftReadResult.Found(shift) };
        var handler = new Elevant.Application.Operations.GetOccAgentShift.GetOccAgentShiftHandler(new Resolver(Actor()), store);
        var found = await handler.HandleAsync(new(AccountId, TurnaroundId, AgentId), TestContext.Current.CancellationToken);

        Assert.True(found.IsSuccess);
        Assert.Equal(shift, found.Shift);
        Assert.Equal([StationId], store.ShiftRequest!.AllowedStationIds);
        Assert.Equal((TurnaroundId, AgentId), (store.ShiftRequest.TurnaroundId, store.ShiftRequest.AgentId));
    }

    [Theory]
    [InlineData("no-shift", OccPlanningFailure.NotFound, "shift_not_found")]
    [InlineData("out-of-scope", OccPlanningFailure.NotFound, null)]
    [InlineData("wrong-role", OccPlanningFailure.Forbidden, null)]
    [InlineData("empty-agent", OccPlanningFailure.InvalidRequest, null)]
    public async Task TheAgentsShiftNamesWhyItIsMissing(string scenario, OccPlanningFailure expected, string? code)
    {
        var actor = Actor();
        var query = new Elevant.Application.Operations.GetOccAgentShift.GetOccAgentShiftQuery(AccountId, TurnaroundId, AgentId);
        var store = new StubStore();
        switch (scenario)
        {
            case "out-of-scope":
                store = new StubStore { ShiftResponse = OccAgentShiftReadResult.Failed(OccAgentShiftReadFailure.NotFound) };
                break;
            case "wrong-role": actor = actor with { Roles = [actor.Roles[0] with { Code = "FINANZAS" }] }; break;
            case "empty-agent": query = query with { AgentId = Guid.Empty }; break;
        }
        var result = await new Elevant.Application.Operations.GetOccAgentShift.GetOccAgentShiftHandler(new Resolver(actor),
            store).HandleAsync(query, TestContext.Current.CancellationToken);

        Assert.Equal((expected, code), (result.Failure, result.Code));
    }

    private static ProgramOccShiftCommand Command() => new(
        AccountId, TurnaroundId, AgentId, new TimeOnly(6, 0), new TimeOnly(14, 0),
        Guid.NewGuid(), "unit-test");

    private static ActorContext Actor() => new(
        AccountId, "occ@dev.elevant.test", "OCC Tester",
        [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "admin_occ")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    private sealed class StubStore : IOccShiftProgrammingStore
    {
        public OccShiftWriteRequest? Request { get; private set; }
        public OccShiftWriteResult Response { get; init; } = OccShiftWriteResult.Created(ShiftId);
        public OccAgentShiftReadRequest? ShiftRequest { get; private set; }
        public OccAgentShiftReadResult ShiftResponse { get; init; } =
            OccAgentShiftReadResult.Failed(OccAgentShiftReadFailure.ShiftNotFound);

        public Task<OccShiftWriteResult> ProgramAsync(OccShiftWriteRequest request, CancellationToken cancellationToken = default)
        {
            Request = request;
            return Task.FromResult(Response);
        }

        public Task<OccAgentShiftReadResult> GetAgentShiftAsync(OccAgentShiftReadRequest request,
            CancellationToken cancellationToken = default)
        {
            ShiftRequest = request;
            return Task.FromResult(ShiftResponse);
        }
    }
}
