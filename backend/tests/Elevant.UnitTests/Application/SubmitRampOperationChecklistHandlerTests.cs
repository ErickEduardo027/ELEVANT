using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Application.Operations.SubmitRampOperationChecklist;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class SubmitRampOperationChecklistHandlerTests
{
    [Fact]
    public async Task ValidCommandForwardsExactDeviceCommandAndServerScope()
    {
        var actor = RampExecutionTestData.CreateActor() with
        {
            StationScopes =
            [
                RampExecutionTestData.CreateActor().StationScopes[0],
                RampExecutionTestData.CreateActor().StationScopes[0],
                new(RampExecutionTestData.SecondStationId, "SDQ"),
            ],
        };
        var submission = CreateSubmission();
        var store = new StubStore(RampChecklistSubmissionWriteResult.Success(
            submission,
            RampExecutionTestData.ReceiptId));
        var handler = new SubmitRampOperationChecklistHandler(
            new RampExecutionActorResolver(actor),
            store);
        var command = CreateCommand();

        var result = await handler.HandleAsync(
            command,
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(submission, result.Submission);
        Assert.NotNull(store.Request);
        Assert.Equal(command.AccountId, store.Request.ActorAccountId);
        Assert.Equal(
            [RampExecutionTestData.StationId, RampExecutionTestData.SecondStationId],
            store.Request.AllowedStationIds);
        Assert.Equal(command.OperationId, store.Request.OperationId);
        Assert.Equal(command.ChecklistId, store.Request.ChecklistId);
        Assert.Same(command.Answers, store.Request.Answers);
        Assert.Equal(command.InstallationId, store.Request.InstallationId);
        Assert.Equal(command.IdempotencyKey, store.Request.IdempotencyKey);
        Assert.Equal(command.CorrelationId, store.Request.CorrelationId);
        Assert.Equal(command.RequestId, store.Request.RequestId);
    }

    [Fact]
    public async Task MalformedAnswersAreRejectedBeforeResolvingActor()
    {
        var resolver = new RampExecutionActorResolver(RampExecutionTestData.CreateActor());
        var store = new StubStore(RampChecklistSubmissionWriteResult.Success(
            CreateSubmission(),
            RampExecutionTestData.ReceiptId));
        var handler = new SubmitRampOperationChecklistHandler(resolver, store);
        var duplicate = new RampChecklistAnswerWriteData(
            RampExecutionTestData.ItemId,
            ChecklistAnswerValue.Ok,
            null);

        var result = await handler.HandleAsync(
            CreateCommand() with { Answers = [duplicate, duplicate] },
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.InvalidRequest, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task MissingActorIsUnauthorized()
    {
        var store = new StubStore(RampChecklistSubmissionWriteResult.Failed(
            RampChecklistSubmissionWriteFailure.Forbidden));
        var handler = new SubmitRampOperationChecklistHandler(
            new RampExecutionActorResolver(null),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(RampOperationsFailure.Unauthorized, result.Failure);
        Assert.Null(store.Request);
    }

    [Theory]
    [InlineData(RampChecklistSubmissionWriteFailure.Forbidden, RampOperationsFailure.Forbidden)]
    [InlineData(RampChecklistSubmissionWriteFailure.NotFound, RampOperationsFailure.NotFound)]
    [InlineData(RampChecklistSubmissionWriteFailure.Conflict, RampOperationsFailure.Conflict)]
    [InlineData(RampChecklistSubmissionWriteFailure.IdempotencyKeyConflict, RampOperationsFailure.Conflict)]
    public async Task StoreFailuresAreMapped(
        RampChecklistSubmissionWriteFailure storeFailure,
        RampOperationsFailure expected)
    {
        var handler = new SubmitRampOperationChecklistHandler(
            new RampExecutionActorResolver(RampExecutionTestData.CreateActor()),
            new StubStore(RampChecklistSubmissionWriteResult.Failed(storeFailure)));

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(expected, result.Failure);
    }

    private static SubmitRampOperationChecklistCommand CreateCommand() => new(
        RampExecutionTestData.AccountId,
        RampExecutionTestData.OperationId,
        RampExecutionTestData.ChecklistId,
        [
            new RampChecklistAnswerWriteData(
                RampExecutionTestData.ItemId,
                ChecklistAnswerValue.Ok,
                null),
        ],
        RampExecutionTestData.InstallationId,
        RampExecutionTestData.IdempotencyKey,
        RampExecutionTestData.IdempotencyKey,
        "request-1");

    private static RampChecklistSubmissionData CreateSubmission()
    {
        var now = new DateTimeOffset(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);
        return new(
            RampExecutionTestData.ReceiptId,
            new RampChecklistSubmissionSummaryData(
                RampExecutionTestData.ChecklistId,
                "Submitted",
                now,
                now,
                1));
    }

    private sealed class StubStore(RampChecklistSubmissionWriteResult result)
        : IRampOperationChecklistCommandStore
    {
        public RampChecklistSubmissionWriteRequest? Request { get; private set; }

        public Task<RampChecklistSubmissionWriteResult> SubmitChecklistAsync(
            RampChecklistSubmissionWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(result);
        }
    }
}
