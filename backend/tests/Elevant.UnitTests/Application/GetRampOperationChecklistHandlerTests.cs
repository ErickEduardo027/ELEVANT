using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Application.Operations.GetRampOperationChecklist;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class GetRampOperationChecklistHandlerTests
{
    [Fact]
    public async Task ValidQueryPassesOnlyDeduplicatedServerOwnedScope()
    {
        var actor = RampExecutionTestData.CreateActor() with
        {
            StationScopes =
            [
                new ActorStationScope(RampExecutionTestData.StationId, "PUJ"),
                new ActorStationScope(RampExecutionTestData.StationId, "PUJ"),
                new ActorStationScope(RampExecutionTestData.SecondStationId, "SDQ"),
            ],
        };
        var checklist = CreateChecklist();
        var store = new StubStore(RampOperationChecklistReadResult.Success(checklist));
        var handler = new GetRampOperationChecklistHandler(
            new RampExecutionActorResolver(actor),
            store);

        var result = await handler.HandleAsync(
            new GetRampOperationChecklistQuery(
                RampExecutionTestData.AccountId,
                RampExecutionTestData.OperationId),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(checklist, result.Checklist);
        Assert.NotNull(store.Request);
        Assert.Equal(RampExecutionTestData.AccountId, store.Request.ActorAccountId);
        Assert.Equal(
            [RampExecutionTestData.StationId, RampExecutionTestData.SecondStationId],
            store.Request.AllowedStationIds);
        Assert.Equal(RampExecutionTestData.OperationId, store.Request.OperationId);
    }

    [Fact]
    public async Task EmptyOperationIsRejectedBeforeResolvingActor()
    {
        var resolver = new RampExecutionActorResolver(RampExecutionTestData.CreateActor());
        var store = new StubStore(RampOperationChecklistReadResult.Success(CreateChecklist()));
        var handler = new GetRampOperationChecklistHandler(resolver, store);

        var result = await handler.HandleAsync(
            new GetRampOperationChecklistQuery(RampExecutionTestData.AccountId, Guid.Empty),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.InvalidRequest, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task MissingActorIsUnauthorized()
    {
        var store = new StubStore(RampOperationChecklistReadResult.Failed(
            RampOperationChecklistReadFailure.NotFound));
        var handler = new GetRampOperationChecklistHandler(
            new RampExecutionActorResolver(null),
            store);

        var result = await handler.HandleAsync(
            new GetRampOperationChecklistQuery(
                RampExecutionTestData.AccountId,
                RampExecutionTestData.OperationId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task ActorOutsideRampPortalIsForbidden()
    {
        var actor = RampExecutionTestData.CreateActor() with
        {
            Roles =
            [
                RampExecutionTestData.CreateActor().Roles[0] with
                {
                    Portal = PortalKind.BackOffice,
                },
            ],
        };
        var store = new StubStore(RampOperationChecklistReadResult.Failed(
            RampOperationChecklistReadFailure.NotFound));
        var handler = new GetRampOperationChecklistHandler(
            new RampExecutionActorResolver(actor),
            store);

        var result = await handler.HandleAsync(
            new GetRampOperationChecklistQuery(
                RampExecutionTestData.AccountId,
                RampExecutionTestData.OperationId),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Null(store.Request);
    }

    [Theory]
    [InlineData(RampOperationChecklistReadFailure.AgentProfileUnavailable, RampOperationsFailure.Forbidden)]
    [InlineData(RampOperationChecklistReadFailure.NotFound, RampOperationsFailure.NotFound)]
    [InlineData(RampOperationChecklistReadFailure.Conflict, RampOperationsFailure.Conflict)]
    public async Task StoreFailuresAreMapped(
        RampOperationChecklistReadFailure storeFailure,
        RampOperationsFailure expected)
    {
        var handler = new GetRampOperationChecklistHandler(
            new RampExecutionActorResolver(RampExecutionTestData.CreateActor()),
            new StubStore(RampOperationChecklistReadResult.Failed(storeFailure)));

        var result = await handler.HandleAsync(
            new GetRampOperationChecklistQuery(
                RampExecutionTestData.AccountId,
                RampExecutionTestData.OperationId),
            TestContext.Current.CancellationToken);

        Assert.Equal(expected, result.Failure);
    }

    private static RampOperationChecklistData CreateChecklist() => new(
        RampExecutionTestData.OperationId,
        RampExecutionTestData.ChecklistId,
        "NotStarted",
        null,
        null,
        new RampChecklistTemplateData("TURNAROUND-BASE", "Turnaround base checklist", 1),
        [
            new RampChecklistSectionData(
                "Arrival",
                [
                    new RampChecklistItemData(
                        RampExecutionTestData.ItemId,
                        "CHOCKS",
                        "Wheel chocks positioned",
                        1,
                        true,
                        true,
                        null),
                ]),
        ]);

    private sealed class StubStore(RampOperationChecklistReadResult result)
        : IRampOperationChecklistReadStore
    {
        public RampOperationChecklistReadRequest? Request { get; private set; }

        public Task<RampOperationChecklistReadResult> GetChecklistAsync(
            RampOperationChecklistReadRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(result);
        }
    }
}
