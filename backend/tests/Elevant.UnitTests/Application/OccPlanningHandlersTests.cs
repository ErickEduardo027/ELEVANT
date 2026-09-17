using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Application.Operations.GetOccPlanningOptions;
using Elevant.Application.Operations.GetOccPlanningSnapshot;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class OccPlanningHandlersTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SecondStationId = Guid.Parse("20000000-0000-7000-8000-000000000013");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
    private static readonly DateOnly FixtureDate = new(2026, 8, 19);

    [Fact]
    public async Task SnapshotDefaultsToOnlyStationAndLatestAccessibleOperationDate()
    {
        var store = new StubReadStore
        {
            LatestDate = FixtureDate,
            Snapshot = CreateSnapshot(FixtureDate),
        };
        var handler = new GetOccPlanningSnapshotHandler(
            new StubActorContextResolver(CreateActor()),
            store,
            new FixedTimeProvider(new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero)));

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, null, null),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(StationId, store.LatestDateStationId);
        Assert.Equal((StationId, FixtureDate), store.SnapshotRequest);
    }

    [Fact]
    public async Task ExplicitDateDoesNotQueryLatestDate()
    {
        var store = new StubReadStore { Snapshot = CreateSnapshot(FixtureDate) };
        var handler = CreateSnapshotHandler(store, CreateActor());

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, StationId, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Null(store.LatestDateStationId);
        Assert.Equal((StationId, FixtureDate), store.SnapshotRequest);
    }

    [Fact]
    public async Task EmptyStationUsesItsCivilDateInsteadOfUtcDate()
    {
        var localDate = new DateOnly(2026, 8, 19);
        var store = new StubReadStore
        {
            TimeZoneId = "America/Santo_Domingo",
            Snapshot = CreateSnapshot(localDate),
        };
        var handler = new GetOccPlanningSnapshotHandler(
            new StubActorContextResolver(CreateActor()),
            store,
            new FixedTimeProvider(new DateTimeOffset(2026, 8, 20, 2, 30, 0, TimeSpan.Zero)));

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, null, null),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(StationId, store.TimeZoneStationId);
        Assert.Equal((StationId, localDate), store.SnapshotRequest);
    }

    [Fact]
    public async Task OutOfScopeStationIsIndistinguishableFromMissingStation()
    {
        var store = new StubReadStore();
        var handler = CreateSnapshotHandler(store, CreateActor());

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, SecondStationId, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.NotFound, result.Failure);
        Assert.Null(store.SnapshotRequest);
    }

    [Fact]
    public async Task AmbiguousImplicitStationIsRejected()
    {
        var actor = CreateActor() with
        {
            StationScopes =
            [
                new ActorStationScope(StationId, "PUJ"),
                new ActorStationScope(SecondStationId, "SDQ"),
            ],
        };
        var handler = CreateSnapshotHandler(new StubReadStore(), actor);

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, null, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.InvalidRequest, result.Failure);
    }

    [Fact]
    public async Task MissingImplicitStationScopeIsRejected()
    {
        var actor = CreateActor() with { StationScopes = [] };
        var handler = CreateSnapshotHandler(new StubReadStore(), actor);

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, null, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.InvalidRequest, result.Failure);
    }

    [Fact]
    public async Task NonOccBackOfficeActorIsForbidden()
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Code = "CONTRACTS" }],
        };
        var handler = CreateSnapshotHandler(new StubReadStore(), actor);

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, StationId, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Forbidden, result.Failure);
    }

    [Fact]
    public async Task OccRoleFromWrongPortalIsForbidden()
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Portal = PortalKind.RampMobileApp }],
        };
        var handler = CreateSnapshotHandler(new StubReadStore(), actor);

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, StationId, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Forbidden, result.Failure);
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
        var handler = CreateSnapshotHandler(new StubReadStore(), actor);

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, StationId, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Forbidden, result.Failure);
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
        var handler = CreateSnapshotHandler(new StubReadStore(), actor);

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, StationId, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Forbidden, result.Failure);
    }

    [Fact]
    public async Task MissingCurrentActorIsUnauthorized()
    {
        var handler = CreateSnapshotHandler(new StubReadStore(), null);

        var result = await handler.HandleAsync(
            new GetOccPlanningSnapshotQuery(AccountId, StationId, FixtureDate),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Unauthorized, result.Failure);
    }

    [Fact]
    public async Task OptionsUseAllActorStationScopesAndSortEligibleAgentsFirst()
    {
        var actor = CreateActor() with
        {
            StationScopes =
            [
                new ActorStationScope(StationId, "PUJ"),
                new ActorStationScope(SecondStationId, "SDQ"),
            ],
        };
        var store = new StubReadStore { Options = CreateOptions() };
        var handler = new GetOccPlanningOptionsHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            new GetOccPlanningOptionsQuery(AccountId, TurnaroundId),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal([StationId, SecondStationId], store.OptionStationIds);
        Assert.Equal(TurnaroundId, store.OptionTurnaroundId);
        Assert.True(result.Options!.Agents[0].Eligible);
        Assert.False(result.Options.Agents[1].Eligible);
        Assert.Equal(["shift_not_compatible"], result.Options.Agents[1].EligibilityReasons);
    }

    [Fact]
    public async Task InvalidTurnaroundIdentifierIsRejectedBeforePersistence()
    {
        var store = new StubReadStore();
        var handler = new GetOccPlanningOptionsHandler(
            new StubActorContextResolver(CreateActor()),
            store);

        var result = await handler.HandleAsync(
            new GetOccPlanningOptionsQuery(AccountId, Guid.Empty),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.InvalidRequest, result.Failure);
        Assert.Null(store.OptionTurnaroundId);
    }

    [Theory]
    [InlineData(OccPlanningOptionsReadFailure.ContractConflict)]
    [InlineData(OccPlanningOptionsReadFailure.OperationalConflict)]
    public async Task OptionsConflictsFailClosed(OccPlanningOptionsReadFailure failure)
    {
        var store = new StubReadStore
        {
            OptionsFailure = failure,
        };
        var handler = new GetOccPlanningOptionsHandler(
            new StubActorContextResolver(CreateActor()),
            store);

        var result = await handler.HandleAsync(
            new GetOccPlanningOptionsQuery(AccountId, TurnaroundId),
            TestContext.Current.CancellationToken);

        Assert.Equal(OccPlanningFailure.Conflict, result.Failure);
        Assert.Null(result.Options);
    }

    [Fact]
    public async Task CancellationIsObservedBeforeResolvingActor()
    {
        using var source = new CancellationTokenSource();
        await source.CancelAsync();
        var resolver = new StubActorContextResolver(CreateActor());
        var handler = new GetOccPlanningOptionsHandler(resolver, new StubReadStore());

        await Assert.ThrowsAsync<OperationCanceledException>(() => handler.HandleAsync(
            new GetOccPlanningOptionsQuery(AccountId, TurnaroundId),
            source.Token));
        Assert.Equal(0, resolver.CallCount);
    }

    private static GetOccPlanningSnapshotHandler CreateSnapshotHandler(
        StubReadStore store,
        ActorContext? actor) => new(
            new StubActorContextResolver(actor),
            store,
            new FixedTimeProvider(new DateTimeOffset(2030, 1, 1, 0, 0, 0, TimeSpan.Zero)));

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

    private static OccPlanningSnapshotData CreateSnapshot(DateOnly date) => new(
        new OccStationData(StationId, "PUJ", "AVIAM PUJ Development", "America/Santo_Domingo"),
        date,
        []);

    private static OccPlanningOptionsSourceData CreateOptions()
    {
        var station = new OccStationData(
            StationId,
            "PUJ",
            "AVIAM PUJ Development",
            "America/Santo_Domingo");
        var eligible = CreateCandidate(
            Guid.Parse("50000000-0000-7000-8000-000000000001"),
            "Riley Ramp");
        var ineligible = CreateCandidate(
            Guid.Parse("50000000-0000-7000-8000-000000000002"),
            "Alex Agent") with
        {
            HasCompatibleShift = false,
        };

        return new OccPlanningOptionsSourceData(
            new OccPlanningTurnaroundContextData(
                TurnaroundId,
                "DEV-TAT-0002",
                FixtureDate,
                station,
                null,
                new DateTimeOffset(2026, 8, 19, 12, 15, 0, TimeSpan.Zero),
                Convert.ToBase64String(new byte[32])),
            null,
            [],
            [ineligible, eligible]);
    }

    private static OccAgentCandidateData CreateCandidate(Guid id, string name) => new(
        id,
        name,
        $"DEV-{id.ToString("N")[..6]}",
        IsActive: true,
        HasMobileAccount: true,
        HasStationScope: true,
        HasTerminalScope: true,
        HasCurrentQualification: true,
        HasCurrentAirportId: true,
        HasCurrentRampDriverLicense: true,
        HasCompatibleShift: true,
        OperationalPositionId: Guid.Parse("52000000-0000-7000-8000-000000000001"),
        HasAssignmentConflict: false);

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

    private sealed class StubReadStore : IOccPlanningReadStore
    {
        public DateOnly? LatestDate { get; init; }

        public OccPlanningSnapshotData? Snapshot { get; init; }

        public OccPlanningOptionsSourceData? Options { get; init; }

        public OccPlanningOptionsReadFailure? OptionsFailure { get; init; }

        public string? TimeZoneId { get; init; } = "America/Santo_Domingo";

        public Guid? LatestDateStationId { get; private set; }

        public Guid? TimeZoneStationId { get; private set; }

        public (Guid StationId, DateOnly Date)? SnapshotRequest { get; private set; }

        public IReadOnlyCollection<Guid>? OptionStationIds { get; private set; }

        public Guid? OptionTurnaroundId { get; private set; }

        public Task<DateOnly?> GetLatestOperationDateAsync(
            Guid stationId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            LatestDateStationId = stationId;
            return Task.FromResult(LatestDate);
        }

        public Task<OccPlanningSnapshotData?> GetSnapshotAsync(
            Guid stationId,
            DateOnly operationDate,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SnapshotRequest = (stationId, operationDate);
            return Task.FromResult(Snapshot);
        }

        public Task<string?> GetStationTimeZoneAsync(
            Guid stationId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            TimeZoneStationId = stationId;
            return Task.FromResult(TimeZoneId);
        }

        public Task<OccPlanningOptionsReadResult> GetOptionsAsync(
            IReadOnlyCollection<Guid> allowedStationIds,
            Guid turnaroundId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            OptionStationIds = allowedStationIds;
            OptionTurnaroundId = turnaroundId;
            return Task.FromResult(Options is null
                ? OccPlanningOptionsReadResult.Failed(
                    OptionsFailure ?? OccPlanningOptionsReadFailure.NotFound)
                : OccPlanningOptionsReadResult.Success(Options));
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
