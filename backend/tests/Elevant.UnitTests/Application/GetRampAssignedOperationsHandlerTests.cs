using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Application.Operations.GetRampAssignedOperations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class GetRampAssignedOperationsHandlerTests
{
    private static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid StationId =
        Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SecondStationId =
        Guid.Parse("20000000-0000-7000-8000-000000000013");

    [Fact]
    public async Task SuccessReturnsOwnActiveAssignmentsAndUsesExactServerScope()
    {
        var actor = CreateActor() with
        {
            StationScopes =
            [
                new ActorStationScope(StationId, "PUJ"),
                new ActorStationScope(StationId, "PUJ"),
                new ActorStationScope(SecondStationId, "SDQ"),
            ],
        };
        var operations = new[] { CreateAssignedOperation() };
        var store = new StubRampOperationsReadStore
        {
            Result = RampOperationsReadResult.Success(operations),
        };
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(operations, result.Operations);
        Assert.Null(result.Failure);
        Assert.Equal(AccountId, store.AccountId);
        Assert.Equal([StationId, SecondStationId], store.AllowedStationIds);
        Assert.Equal(1, store.CallCount);
    }

    [Fact]
    public async Task EmptyAssignmentListIsAValidSuccess()
    {
        var operations = Array.Empty<RampAssignedOperationData>();
        var store = new StubRampOperationsReadStore
        {
            Result = RampOperationsReadResult.Success(operations),
        };
        var handler = CreateHandler(CreateActor(), store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(operations, result.Operations);
        Assert.Empty(result.Operations!);
    }

    [Theory]
    [InlineData("ADMIN_OCC")]
    [InlineData("ramp_agent")]
    public async Task AnyRoleOtherThanExactRampAgentIsForbidden(string roleCode)
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Code = roleCode }],
        };
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Null(result.Operations);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task MalformedActorIsUnauthorized()
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Code = string.Empty }],
        };
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Equal(0, store.CallCount);
    }

    [Theory]
    [InlineData(PortalKind.BackOffice)]
    [InlineData(PortalKind.AirlinePortal)]
    public async Task RampRoleOutsideRampMobilePortalIsForbidden(PortalKind portal)
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Portal = portal }],
        };
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task NonAviamMembershipIsForbidden()
    {
        var actor = CreateActor() with
        {
            Memberships =
            [
                CreateActor().Memberships[0] with
                {
                    OrganizationType = OrganizationType.AirlineCustomer,
                },
            ],
        };
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task NonInternalMembershipIsForbidden()
    {
        var actor = CreateActor() with
        {
            Memberships =
            [
                CreateActor().Memberships[0] with
                {
                    Kind = MembershipKind.AirlineClient,
                },
            ],
        };
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task ActorWithoutStationScopeIsForbidden()
    {
        var actor = CreateActor() with { StationScopes = [] };
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task EmptyAccountIsUnauthorizedWithoutResolvingActor()
    {
        var resolver = new StubActorContextResolver(CreateActor());
        var store = new StubRampOperationsReadStore();
        var handler = new GetRampAssignedOperationsHandler(resolver, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(Guid.Empty),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task MissingActorIsUnauthorized()
    {
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(null, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task ActorForDifferentAccountIsUnauthorized()
    {
        var actor = CreateActor() with { AccountId = Guid.NewGuid() };
        var store = new StubRampOperationsReadStore();
        var handler = CreateHandler(actor, store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task UnavailableAgentProfileIsForbidden()
    {
        var store = new StubRampOperationsReadStore
        {
            Result = RampOperationsReadResult.Failed(
                RampOperationsReadFailure.AgentProfileUnavailable),
        };
        var handler = CreateHandler(CreateActor(), store);

        var result = await handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Null(result.Operations);
        Assert.Equal(1, store.CallCount);
    }

    [Fact]
    public async Task CancellationIsObservedBeforeResolvingActor()
    {
        using var source = new CancellationTokenSource();
        await source.CancelAsync();
        var resolver = new StubActorContextResolver(CreateActor());
        var store = new StubRampOperationsReadStore();
        var handler = new GetRampAssignedOperationsHandler(resolver, store);

        await Assert.ThrowsAsync<OperationCanceledException>(() => handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            source.Token));

        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, store.CallCount);
    }

    [Fact]
    public async Task CancellationFromStoreIsPropagated()
    {
        using var source = new CancellationTokenSource();
        var resolver = new StubActorContextResolver(CreateActor(), source.Cancel);
        var store = new StubRampOperationsReadStore();
        var handler = new GetRampAssignedOperationsHandler(resolver, store);

        await Assert.ThrowsAsync<OperationCanceledException>(() => handler.HandleAsync(
            new GetRampAssignedOperationsQuery(AccountId),
            source.Token));

        Assert.Equal(1, resolver.CallCount);
        Assert.Equal(1, store.CallCount);
        Assert.Equal(source.Token, store.CancellationToken);
    }

    private static GetRampAssignedOperationsHandler CreateHandler(
        ActorContext? actor,
        StubRampOperationsReadStore store) =>
        new(new StubActorContextResolver(actor), store);

    private static ActorContext CreateActor() => new(
        AccountId,
        "ramp.agent@dev.elevant.test",
        "Riley Ramp",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000002"),
                "RAMP_AGENT",
                "Ramp Agent",
                PortalKind.RampMobileApp,
                "ramp_agent"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000002"),
                Guid.Parse("10000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM Development",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [new ActorStationScope(StationId, "PUJ")]);

    private static RampAssignedOperationData CreateAssignedOperation()
    {
        var airport = new RampAirportData(
            Guid.Parse("21000000-0000-7000-8000-000000000001"),
            "PUJ",
            "MDPC",
            "Punta Cana International Airport");
        var station = new RampStationData(
            StationId,
            "PUJ",
            "AVIAM PUJ Development",
            "America/Santo_Domingo");

        return new RampAssignedOperationData(
            new RampAgentAssignmentData(
                Guid.Parse("74000000-0000-7000-8000-000000000001"),
                Guid.Parse("50000000-0000-7000-8000-000000000001"),
                new RampOperationalPositionData(
                    Guid.Parse("52000000-0000-7000-8000-000000000001"),
                    "RAMP",
                    "Ramp Agent"),
                "ramp_agent",
                new DateTimeOffset(2026, 8, 19, 11, 30, 0, TimeSpan.Zero)),
            new RampGroundOperationData(
                Guid.Parse("71000000-0000-7000-8000-000000000001"),
                "Assigned",
                new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero),
                new DateTimeOffset(2026, 8, 19, 13, 0, 0, TimeSpan.Zero),
                null,
                null),
            new RampTurnaroundData(
                Guid.Parse("70000000-0000-7000-8000-000000000001"),
                "DEV-TAT-0001",
                new DateOnly(2026, 8, 19),
                "Confirmed",
                station,
                new RampAirlineData(
                    Guid.Parse("11000000-0000-7000-8000-000000000001"),
                    "DM",
                    "DWI",
                    "Arajet"),
                new RampAircraftData(
                    Guid.Parse("22000000-0000-7000-8000-000000000001"),
                    "B738",
                    "738",
                    "Boeing",
                    "737-800",
                    "HI-1001"),
                new RampStandData(
                    Guid.Parse("23000000-0000-7000-8000-000000000001"),
                    "A1",
                    new RampTerminalData(
                        Guid.Parse("24000000-0000-7000-8000-000000000001"),
                        "A",
                        "Terminal A")),
                new RampFlightLegData(
                    Guid.Parse("72000000-0000-7000-8000-000000000001"),
                    "DM 100",
                    airport,
                    airport,
                    new DateTimeOffset(2026, 8, 19, 11, 45, 0, TimeSpan.Zero),
                    null,
                    null),
                null),
            [
                new RampOperationServiceData(
                    Guid.Parse("73000000-0000-7000-8000-000000000001"),
                    1,
                    Guid.Parse("30000000-0000-7000-8000-000000000001"),
                    "BAGGAGE",
                    "Baggage handling",
                    1m,
                    0m,
                    "operation",
                    "Pending"),
            ]);
    }

    private sealed class StubActorContextResolver(
        ActorContext? actor,
        Action? afterResolve = null) : IActorContextResolver
    {
        public int CallCount { get; private set; }

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            CallCount++;
            afterResolve?.Invoke();
            return Task.FromResult(actor);
        }
    }

    private sealed class StubRampOperationsReadStore : IRampOperationsReadStore
    {
        public RampOperationsReadResult Result { get; init; } =
            RampOperationsReadResult.Success([]);

        public int CallCount { get; private set; }

        public Guid? AccountId { get; private set; }

        public IReadOnlyCollection<Guid>? AllowedStationIds { get; private set; }

        public CancellationToken CancellationToken { get; private set; }

        public Task<RampOperationsReadResult> GetActiveAssignedOperationsAsync(
            Guid accountId,
            IReadOnlyCollection<Guid> allowedStationIds,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            AccountId = accountId;
            AllowedStationIds = allowedStationIds;
            CancellationToken = cancellationToken;
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Result);
        }
    }
}
