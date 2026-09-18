using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Application.Operations.StartRampOperation;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class StartRampOperationHandlerTests
{
    private static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid StationId =
        Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SecondStationId =
        Guid.Parse("20000000-0000-7000-8000-000000000013");
    private static readonly Guid OperationId =
        Guid.Parse("70000000-0000-7000-8000-000000000005");
    private static readonly Guid InstallationId =
        Guid.Parse("81000000-0000-7000-8000-000000000001");
    private static readonly Guid IdempotencyKey =
        Guid.Parse("82000000-0000-7000-8000-000000000001");
    private static readonly Guid ReceiptId =
        Guid.Parse("83000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task ValidCommandPassesOnlyDeduplicatedServerOwnedScope()
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
        var start = CreateStart();
        var store = new StubStore(RampOperationStartWriteResult.Success(start, ReceiptId));
        var handler = new StartRampOperationHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(start, result.Start);
        Assert.NotNull(store.Request);
        Assert.Equal(AccountId, store.Request.ActorAccountId);
        Assert.Equal([StationId, SecondStationId], store.Request.AllowedStationIds);
        Assert.Equal(OperationId, store.Request.OperationId);
        Assert.Equal(InstallationId, store.Request.InstallationId);
        Assert.Equal(IdempotencyKey, store.Request.IdempotencyKey);
        Assert.Equal(IdempotencyKey, store.Request.CorrelationId);
        Assert.Equal("request-1", store.Request.RequestId);
    }

    [Fact]
    public async Task EmptyCommandIdentifiersAreRejectedBeforeResolvingActor()
    {
        var resolver = new StubActorContextResolver(CreateActor());
        var store = new StubStore(RampOperationStartWriteResult.Success(CreateStart(), ReceiptId));
        var handler = new StartRampOperationHandler(resolver, store);

        var result = await handler.HandleAsync(
            CreateCommand() with { InstallationId = Guid.Empty },
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.InvalidRequest, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task MissingActorIsUnauthorized()
    {
        var store = new StubStore(RampOperationStartWriteResult.Failed(
            RampOperationStartWriteFailure.Forbidden));
        var handler = new StartRampOperationHandler(
            new StubActorContextResolver(null),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task ActorWithoutRampRoleIsForbidden()
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Portal = PortalKind.BackOffice }],
        };
        var store = new StubStore(RampOperationStartWriteResult.Failed(
            RampOperationStartWriteFailure.Forbidden));
        var handler = new StartRampOperationHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task ActorWithoutStationScopeIsForbidden()
    {
        var actor = CreateActor() with { StationScopes = [] };
        var store = new StubStore(RampOperationStartWriteResult.Failed(
            RampOperationStartWriteFailure.NotFound));
        var handler = new StartRampOperationHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Null(store.Request);
    }

    [Theory]
    [InlineData(RampOperationStartWriteFailure.Forbidden, RampOperationsFailure.Forbidden)]
    [InlineData(RampOperationStartWriteFailure.NotFound, RampOperationsFailure.NotFound)]
    [InlineData(RampOperationStartWriteFailure.Conflict, RampOperationsFailure.Conflict)]
    [InlineData(RampOperationStartWriteFailure.IdempotencyKeyConflict, RampOperationsFailure.Conflict)]
    public async Task StoreFailuresAreMapped(
        RampOperationStartWriteFailure storeFailure,
        RampOperationsFailure expectedFailure)
    {
        var handler = new StartRampOperationHandler(
            new StubActorContextResolver(CreateActor()),
            new StubStore(RampOperationStartWriteResult.Failed(storeFailure)));

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(expectedFailure, result.Failure);
        Assert.Null(result.Start);
    }

    [Fact]
    public async Task CancellationIsObservedBeforeResolvingActor()
    {
        using var source = new CancellationTokenSource();
        await source.CancelAsync();
        var resolver = new StubActorContextResolver(CreateActor());
        var handler = new StartRampOperationHandler(
            resolver,
            new StubStore(RampOperationStartWriteResult.Failed(
                RampOperationStartWriteFailure.Conflict)));

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            handler.HandleAsync(CreateCommand(), source.Token));
        Assert.Equal(0, resolver.CallCount);
    }

    [Theory]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.Assigned, true)]
    [InlineData(TurnaroundStatus.InProgress, GroundOperationStatus.Assigned, true)]
    [InlineData(TurnaroundStatus.Scheduled, GroundOperationStatus.Assigned, false)]
    [InlineData(TurnaroundStatus.Completed, GroundOperationStatus.Assigned, false)]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.Planned, false)]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress, false)]
    public void StartPolicyFailsClosedForUnsupportedStates(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        bool expected)
    {
        Assert.Equal(expected, RampOperationStartPolicy.CanStart(
            turnaroundStatus,
            operationStatus,
            null,
            null));
    }

    [Fact]
    public void StartPolicyRejectsExistingActualTimestamps()
    {
        var now = new DateTimeOffset(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

        Assert.False(RampOperationStartPolicy.CanStart(
            TurnaroundStatus.Confirmed,
            GroundOperationStatus.Assigned,
            now,
            null));
        Assert.False(RampOperationStartPolicy.CanStart(
            TurnaroundStatus.Confirmed,
            GroundOperationStatus.Assigned,
            null,
            now));
    }

    private static StartRampOperationCommand CreateCommand() => new(
        AccountId,
        OperationId,
        InstallationId,
        IdempotencyKey,
        IdempotencyKey,
        "request-1");

    private static RampOperationStartData CreateStart()
    {
        var now = new DateTimeOffset(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);
        return new RampOperationStartData(
            ReceiptId,
            new RampGroundOperationData(
                OperationId,
                "InProgress",
                now.AddMinutes(-15),
                now.AddHours(2),
                now,
                null));
    }

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

    private sealed class StubActorContextResolver(ActorContext? actor) : IActorContextResolver
    {
        public int CallCount { get; private set; }

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            CallCount++;
            return Task.FromResult(actor);
        }
    }

    private sealed class StubStore(RampOperationStartWriteResult result)
        : IRampOperationsCommandStore
    {
        public RampOperationStartWriteRequest? Request { get; private set; }

        public Task<RampOperationStartWriteResult> StartOperationAsync(
            RampOperationStartWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(result);
        }
    }
}
