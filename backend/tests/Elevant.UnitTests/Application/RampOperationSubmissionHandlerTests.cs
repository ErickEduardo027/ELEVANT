using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class RampOperationSubmissionHandlerTests
{
    [Fact]
    public async Task ValidHandoffUsesServerOwnedStationScopeAndStableCommandKey()
    {
        var actor = RampExecutionTestData.CreateActor() with
        {
            StationScopes =
            [
                new(RampExecutionTestData.StationId, "PUJ"),
                new(RampExecutionTestData.StationId, "PUJ"),
                new(RampExecutionTestData.SecondStationId, "SDQ"),
            ],
        };
        var store = new StubStore(RampOperationSubmissionWriteResult.Success(
            new RampOperationSubmissionData(
                RampExecutionTestData.ReceiptId,
                RampExecutionTestData.OperationId,
                RampExecutionTestData.IdempotencyKey,
                RampExecutionTestData.ChecklistId,
                1,
                "PendingReview",
                DateTimeOffset.UtcNow,
                DateTimeOffset.UtcNow,
                "Listo"),
            RampExecutionTestData.ReceiptId));
        var handler = new RampOperationSubmissionHandler(
            new RampExecutionActorResolver(actor), store);

        var result = await handler.SubmitAsync(
            RampExecutionTestData.AccountId,
            RampExecutionTestData.OperationId,
            RampExecutionTestData.InstallationId,
            RampExecutionTestData.IdempotencyKey,
            "  Listo  ",
            "request-1",
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.NotNull(store.Request);
        Assert.Equal([RampExecutionTestData.StationId, RampExecutionTestData.SecondStationId],
            store.Request.AllowedStationIds);
        Assert.Equal("Listo", store.Request.AgentNote);
        Assert.Equal(RampExecutionTestData.IdempotencyKey, store.Request.CorrelationId);
        Assert.Equal("request-1", store.Request.RequestId);
    }

    [Fact]
    public async Task InvalidCommandNeverReachesStoreOrActorResolver()
    {
        var resolver = new RampExecutionActorResolver(RampExecutionTestData.CreateActor());
        var store = new StubStore(RampOperationSubmissionWriteResult.Failed(
            RampOperationsFailure.Conflict));
        var handler = new RampOperationSubmissionHandler(resolver, store);

        var result = await handler.SubmitAsync(
            RampExecutionTestData.AccountId,
            RampExecutionTestData.OperationId,
            Guid.Empty,
            RampExecutionTestData.IdempotencyKey,
            "Sin observaciones",
            null,
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.InvalidRequest, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task NonRampActorCannotHandOffOperation()
    {
        var actor = RampExecutionTestData.CreateActor() with
        {
            Roles =
            [
                RampExecutionTestData.CreateActor().Roles[0] with
                { Portal = PortalKind.BackOffice },
            ],
        };
        var store = new StubStore(RampOperationSubmissionWriteResult.Failed(
            RampOperationsFailure.Conflict));
        var handler = new RampOperationSubmissionHandler(
            new RampExecutionActorResolver(actor), store);

        var result = await handler.SubmitAsync(
            RampExecutionTestData.AccountId,
            RampExecutionTestData.OperationId,
            RampExecutionTestData.InstallationId,
            RampExecutionTestData.IdempotencyKey,
            null,
            null,
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Forbidden, result.Failure);
        Assert.Null(store.Request);
    }

    private sealed class StubStore(RampOperationSubmissionWriteResult result)
        : IRampOperationSubmissionStore
    {
        public RampOperationSubmissionWriteRequest? Request { get; private set; }

        public Task<RampOperationSubmissionWriteResult> SubmitAsync(
            RampOperationSubmissionWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            Request = request;
            return Task.FromResult(result);
        }
    }
}
