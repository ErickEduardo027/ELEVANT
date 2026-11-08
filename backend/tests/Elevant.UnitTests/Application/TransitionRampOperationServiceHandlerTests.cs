using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Application.Operations.TransitionRampOperationService;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class TransitionRampOperationServiceHandlerTests
{
    [Fact]
    public async Task ValidCommandForwardsExactDeviceCommandAndServerScope()
    {
        var transition = CreateTransition();
        var store = new StubStore(RampOperationServiceTransitionWriteResult.Success(
            transition,
            RampExecutionTestData.ReceiptId));
        var handler = new TransitionRampOperationServiceHandler(
            new RampExecutionActorResolver(RampExecutionTestData.CreateActor()),
            store);
        var command = CreateCommand();

        var result = await handler.HandleAsync(
            command,
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(transition, result.Transition);
        Assert.NotNull(store.Request);
        Assert.Equal(command.AccountId, store.Request.ActorAccountId);
        Assert.Equal([RampExecutionTestData.StationId], store.Request.AllowedStationIds);
        Assert.Equal(command.OperationId, store.Request.OperationId);
        Assert.Equal(command.ServiceId, store.Request.ServiceId);
        Assert.Equal(command.TargetStatus, store.Request.TargetStatus);
        Assert.Equal(command.ExecutedQuantity, store.Request.ExecutedQuantity);
        Assert.Equal(command.Note, store.Request.Note);
        Assert.Equal(command.InstallationId, store.Request.InstallationId);
        Assert.Equal(command.IdempotencyKey, store.Request.IdempotencyKey);
        Assert.Equal(command.CorrelationId, store.Request.CorrelationId);
        Assert.Equal(command.RequestId, store.Request.RequestId);
    }

    [Fact]
    public async Task InvalidTerminalQuantityIsRejectedBeforeResolvingActor()
    {
        var resolver = new RampExecutionActorResolver(RampExecutionTestData.CreateActor());
        var store = new StubStore(RampOperationServiceTransitionWriteResult.Success(
            CreateTransition(),
            RampExecutionTestData.ReceiptId));
        var handler = new TransitionRampOperationServiceHandler(resolver, store);

        var result = await handler.HandleAsync(
            CreateCommand() with { ExecutedQuantity = null },
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.InvalidRequest, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task MissingActorIsUnauthorized()
    {
        var store = new StubStore(RampOperationServiceTransitionWriteResult.Failed(
            RampOperationServiceTransitionWriteFailure.Forbidden));
        var handler = new TransitionRampOperationServiceHandler(
            new RampExecutionActorResolver(null),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Null(store.Request);
    }

    [Theory]
    [InlineData(RampOperationServiceTransitionWriteFailure.Forbidden, RampOperationsFailure.Forbidden)]
    [InlineData(RampOperationServiceTransitionWriteFailure.NotFound, RampOperationsFailure.NotFound)]
    [InlineData(RampOperationServiceTransitionWriteFailure.Conflict, RampOperationsFailure.Conflict)]
    [InlineData(RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict, RampOperationsFailure.Conflict)]
    public async Task StoreFailuresAreMapped(
        RampOperationServiceTransitionWriteFailure storeFailure,
        RampOperationsFailure expected)
    {
        var handler = new TransitionRampOperationServiceHandler(
            new RampExecutionActorResolver(RampExecutionTestData.CreateActor()),
            new StubStore(RampOperationServiceTransitionWriteResult.Failed(storeFailure)));

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(expected, result.Failure);
    }

    // 3-I: the tapped transition travels in UTC; refusals keep their code and a reused key is coded.
    [Fact]
    public async Task TheTappedTimeTravelsInUtcAndARefusalKeepsItsCode()
    {
        var store = new StubStore(RampOperationServiceTransitionWriteResult.Failed(
            RampOperationServiceTransitionWriteFailure.Conflict, RampExecutionTestData.ReceiptId,
            RampProblemCodes.ServiceTimeOutOfOrder));
        var handler = new TransitionRampOperationServiceHandler(
            new RampExecutionActorResolver(RampExecutionTestData.CreateActor()), store);
        var tapped = new DateTimeOffset(2026, 9, 17, 8, 30, 0, TimeSpan.FromHours(-4));

        var result = await handler.HandleAsync(CreateCommand() with { OccurredAt = tapped },
            TestContext.Current.CancellationToken);

        Assert.Equal(TimeSpan.Zero, store.Request!.OccurredAt!.Value.Offset);
        Assert.Equal(tapped.UtcDateTime, store.Request.OccurredAt.Value.UtcDateTime);
        Assert.Equal(RampProblemCodes.ServiceTimeOutOfOrder, result.Code);
    }

    [Fact]
    public async Task WithoutATappedTimeNothingIsSentAndAReusedKeyIsCoded()
    {
        var store = new StubStore(RampOperationServiceTransitionWriteResult.Failed(
            RampOperationServiceTransitionWriteFailure.IdempotencyKeyConflict));
        var handler = new TransitionRampOperationServiceHandler(
            new RampExecutionActorResolver(RampExecutionTestData.CreateActor()), store);

        var result = await handler.HandleAsync(CreateCommand(), TestContext.Current.CancellationToken);

        Assert.Null(store.Request!.OccurredAt);
        Assert.Equal(RampOperationsFailure.Conflict, result.Failure);
        Assert.Equal(RampProblemCodes.IdempotencyConflict, result.Code);
    }

    private static TransitionRampOperationServiceCommand CreateCommand() => new(
        RampExecutionTestData.AccountId,
        RampExecutionTestData.OperationId,
        RampExecutionTestData.ServiceId,
        ServiceExecutionStatus.Completed,
        1m,
        null,
        RampExecutionTestData.InstallationId,
        RampExecutionTestData.IdempotencyKey,
        RampExecutionTestData.IdempotencyKey,
        "request-1");

    private static RampOperationServiceTransitionData CreateTransition() => new(
        RampExecutionTestData.ReceiptId,
        new RampOperationServiceExecutionData(
            RampExecutionTestData.ServiceId,
            "Completed",
            1m,
            1m,
            "service"));

    private sealed class StubStore(RampOperationServiceTransitionWriteResult result)
        : IRampOperationServiceCommandStore
    {
        public RampOperationServiceTransitionWriteRequest? Request { get; private set; }

        public Task<RampOperationServiceTransitionWriteResult> TransitionServiceAsync(
            RampOperationServiceTransitionWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(result);
        }
    }
}
