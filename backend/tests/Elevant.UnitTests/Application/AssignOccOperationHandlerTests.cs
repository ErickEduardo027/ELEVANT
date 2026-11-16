using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Application.Operations.AssignOccOperation;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class AssignOccOperationHandlerTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SecondStationId = Guid.Parse("20000000-0000-7000-8000-000000000013");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
    private static readonly Guid AgentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
    private static readonly Guid CorrelationId = Guid.Parse("90000000-0000-7000-8000-000000000001");
    private static readonly Guid ReceiptId = Guid.Parse("90000000-0000-7000-8000-000000000002");
    private static readonly byte[] Version = Enumerable.Range(1, 32).Select(value => (byte)value).ToArray();

    [Fact]
    public async Task ValidCommandPassesServerOwnedScopeAndDecodedVersionToStore()
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
        var assignment = CreateAssignment();
        var store = new StubCommandStore(OccAssignmentWriteResult.Success(assignment, ReceiptId));
        var handler = new AssignOccOperationHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(assignment, result.Assignment);
        Assert.NotNull(store.Request);
        Assert.Equal(AccountId, store.Request.ActorAccountId);
        Assert.Equal([StationId, SecondStationId], store.Request.AllowedStationIds);
        Assert.Equal(TurnaroundId, store.Request.TurnaroundId);
        Assert.Equal(AgentId, store.Request.AgentId);
        Assert.Equal(Version, store.Request.ExpectedContextVersion);
        Assert.Equal(CorrelationId, store.Request.CorrelationId);
        Assert.Equal("request-1", store.Request.RequestId);
    }

    [Theory]
    [InlineData(OccAssignmentWriteFailure.NotFound, OccPlanningFailure.NotFound)]
    [InlineData(OccAssignmentWriteFailure.Conflict, OccPlanningFailure.Conflict)]
    [InlineData(OccAssignmentWriteFailure.PreconditionFailed, OccPlanningFailure.PreconditionFailed)]
    public async Task StoreFailuresAreMappedWithoutReturningData(
        OccAssignmentWriteFailure storeFailure,
        OccPlanningFailure expectedFailure)
    {
        var store = new StubCommandStore(OccAssignmentWriteResult.Failed(storeFailure));
        var handler = new AssignOccOperationHandler(
            new StubActorContextResolver(CreateActor()),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(expectedFailure, result.Failure);
        Assert.Null(result.Assignment);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-base64")]
    [InlineData("AQID")]
    [InlineData(" AAAAAAAAAAA=")]
    public async Task InvalidConcurrencyTokenIsRejectedBeforeResolvingActor(string token)
    {
        var resolver = new StubActorContextResolver(CreateActor());
        var store = new StubCommandStore(OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId));
        var handler = new AssignOccOperationHandler(resolver, store);

        var result = await handler.HandleAsync(
            CreateCommand() with { ExpectedConcurrencyToken = token },
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.InvalidRequest, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task MissingActorIsUnauthorized()
    {
        var store = new StubCommandStore(OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId));
        var handler = new AssignOccOperationHandler(
            new StubActorContextResolver(null),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Unauthorized, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task ActorWithoutOccRoleIsForbidden()
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Code = "CONTRACTS" }],
        };
        var store = new StubCommandStore(OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId));
        var handler = new AssignOccOperationHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Forbidden, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task AuthorizedActorWithoutStationScopeReturnsNotFound()
    {
        var actor = CreateActor() with { StationScopes = [] };
        var store = new StubCommandStore(OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId));
        var handler = new AssignOccOperationHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.NotFound, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task CancellationIsObservedBeforeResolvingActor()
    {
        using var source = new CancellationTokenSource();
        await source.CancelAsync();
        var resolver = new StubActorContextResolver(CreateActor());
        var handler = new AssignOccOperationHandler(
            resolver,
            new StubCommandStore(OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId)));

        await Assert.ThrowsAsync<OperationCanceledException>(() => handler.HandleAsync(
            CreateCommand(),
            source.Token));
        Assert.Equal(0, resolver.CallCount);
    }

    [Fact]
    public void ConcurrencyTokenRequiresExactlyOneSha256Digest()
    {
        var token = Convert.ToBase64String(Version);

        Assert.True(OccPlanningConcurrencyToken.TryDecode(token, out var decoded));
        Assert.Equal(Version, decoded);
        Assert.False(OccPlanningConcurrencyToken.TryDecode(null, out _));
        Assert.False(OccPlanningConcurrencyToken.TryDecode("AQID", out _));
        Assert.False(OccPlanningConcurrencyToken.TryDecode(
            Convert.ToBase64String(new byte[31]),
            out _));
        Assert.False(OccPlanningConcurrencyToken.TryDecode(
            Convert.ToBase64String(new byte[33]),
            out _));
        Assert.False(OccPlanningConcurrencyToken.TryDecode(
            token.Insert(8, " "),
            out _));
        Assert.False(OccPlanningConcurrencyToken.TryDecode(
            $"{token[..^2]}B=",
            out _));
    }

    [Theory]
    [InlineData(TurnaroundStatus.Scheduled, true)]
    [InlineData(TurnaroundStatus.Confirmed, true)]
    // 3-C: a recorded arrival (InProgress) only means the aircraft is on blocks; the operation is still a plan.
    [InlineData(TurnaroundStatus.InProgress, true)]
    [InlineData(TurnaroundStatus.Completed, false)]
    [InlineData(TurnaroundStatus.Cancelled, false)]
    [InlineData(TurnaroundStatus.Diverted, false)]
    public void AssignmentPolicyFailsClosedForTurnaroundLifecycle(
        TurnaroundStatus status,
        bool expected)
    {
        var start = new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);

        var actual = OccPlanningAssignmentPolicy.CanAssign(
            status,
            GroundOperationStatus.Planned,
            start,
            start.AddHours(2));

        Assert.Equal(expected, actual);
    }

    [Theory]
    [InlineData(GroundOperationStatus.Assigned)]
    [InlineData(GroundOperationStatus.InProgress)]
    [InlineData(GroundOperationStatus.Cancelled)]
    public void AnArrivedFlightTakesAnAgentOnlyWhileItsOperationIsPlanned(GroundOperationStatus operation)
    {
        var start = new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);

        Assert.True(OccPlanningAssignmentPolicy.CanAssign(TurnaroundStatus.InProgress, GroundOperationStatus.Planned, start,
            start.AddHours(2)));
        Assert.False(OccPlanningAssignmentPolicy.CanAssign(TurnaroundStatus.InProgress, operation, start, start.AddHours(2)));
    }

    [Fact]
    public void AssignmentPolicyRejectsNonPlannedOrInvalidWindows()
    {
        var start = new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);

        Assert.False(OccPlanningAssignmentPolicy.CanAssign(
            TurnaroundStatus.Confirmed,
            GroundOperationStatus.Assigned,
            start,
            start.AddHours(2)));
        Assert.False(OccPlanningAssignmentPolicy.CanAssign(
            TurnaroundStatus.Confirmed,
            GroundOperationStatus.Planned,
            null,
            start.AddHours(2)));
        Assert.False(OccPlanningAssignmentPolicy.CanAssign(
            TurnaroundStatus.Confirmed,
            GroundOperationStatus.Planned,
            start,
            start));
        Assert.False(OccPlanningAssignmentPolicy.CanAssign(
            TurnaroundStatus.Confirmed,
            GroundOperationStatus.Planned,
            start.AddMinutes(1),
            start));
    }

    private static AssignOccOperationCommand CreateCommand() => new(
        AccountId,
        TurnaroundId,
        AgentId,
        Convert.ToBase64String(Version),
        CorrelationId,
        "request-1");

    private static ActorContext CreateActor() => new(
        AccountId,
        "admin.occ@dev.elevant.test",
        "Alex Operations",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000001"),
                "ADMIN_OCC",
                "Admin OCC",
                PortalKind.BackOffice,
                "admin_occ"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000001"),
                Guid.Parse("10000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM Development",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [new ActorStationScope(StationId, "PUJ")]);

    private static OccAssignmentData CreateAssignment()
    {
        var now = new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);
        return new OccAssignmentData(
            TurnaroundId,
            new OccGroundOperationData(
                Guid.Parse("70000000-0000-7000-8000-000000000016"),
                "Assigned",
                now,
                now.AddHours(2),
                null,
                null),
            new OccAssignedAgentData(
                Guid.Parse("70000000-0000-7000-8000-000000000018"),
                AgentId,
                "Riley Ramp",
                "DEV-RAMP-001",
                Guid.Parse("52000000-0000-7000-8000-000000000001"),
                "RAMP-AGENT",
                "Ramp agent",
                "primary",
                now),
            [],
            Convert.ToBase64String(Enumerable.Repeat((byte)8, 32).ToArray()));
    }

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

    private sealed class StubCommandStore(OccAssignmentWriteResult result) : IOccPlanningCommandStore
    {
        public OccAssignmentWriteRequest? Request { get; private set; }

        public Task<OccAssignmentWriteResult> AssignOperationAsync(
            OccAssignmentWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(result);
        }
    }
}
