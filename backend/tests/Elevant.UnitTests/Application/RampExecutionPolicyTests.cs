using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class RampExecutionPolicyTests
{
    private static readonly DateTimeOffset StartedAt =
        new(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress, true, false, true)]
    [InlineData(TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, true, false, true)]
    [InlineData(TurnaroundStatus.Scheduled, GroundOperationStatus.InProgress, true, false, false)]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.Assigned, true, false, false)]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress, false, false, false)]
    [InlineData(TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress, true, true, false)]
    public void OperationExecutionRequiresLiveInProgressOperation(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        bool hasStart,
        bool hasEnd,
        bool expected)
    {
        Assert.Equal(expected, RampOperationExecutionPolicy.CanExecute(
            turnaroundStatus,
            operationStatus,
            hasStart ? StartedAt : null,
            hasEnd ? StartedAt.AddHours(1) : null));
    }

    [Fact]
    public void ChecklistAcceptsCompleteRequiredSetAndOptionalOmission()
    {
        var optionalId = Guid.NewGuid();
        var rules = new[]
        {
            new RampChecklistItemRule(RampExecutionTestData.ItemId, true, true),
            new RampChecklistItemRule(optionalId, false, false),
        };
        var answers = new[]
        {
            new RampChecklistAnswerWriteData(
                RampExecutionTestData.ItemId,
                ChecklistAnswerValue.Ok,
                null),
        };

        Assert.True(RampChecklistSubmissionPolicy.CanSubmit(
            ChecklistStatus.NotStarted,
            rules,
            answers));
        Assert.True(RampChecklistSubmissionPolicy.CanSubmit(
            ChecklistStatus.InProgress,
            rules,
            answers));
    }

    [Fact]
    public void ChecklistFailsClosedForMissingUnknownDuplicateAndSubmittedAnswers()
    {
        var rules = new[]
        {
            new RampChecklistItemRule(RampExecutionTestData.ItemId, true, false),
        };
        var valid = new[]
        {
            new RampChecklistAnswerWriteData(
                RampExecutionTestData.ItemId,
                ChecklistAnswerValue.Ok,
                null),
        };

        Assert.False(RampChecklistSubmissionPolicy.CanSubmit(
            ChecklistStatus.NotStarted,
            rules,
            []));
        Assert.False(RampChecklistSubmissionPolicy.CanSubmit(
            ChecklistStatus.NotStarted,
            rules,
            [new RampChecklistAnswerWriteData(Guid.NewGuid(), ChecklistAnswerValue.Ok, null)]));
        Assert.False(RampChecklistSubmissionPolicy.HasValidRequestShape([valid[0], valid[0]]));
        Assert.False(RampChecklistSubmissionPolicy.CanSubmit(
            ChecklistStatus.Submitted,
            rules,
            valid));
    }

    [Fact]
    public void ChecklistRequiresConfiguredNotOkNote()
    {
        var rules = new[]
        {
            new RampChecklistItemRule(RampExecutionTestData.ItemId, true, true),
        };

        Assert.False(RampChecklistSubmissionPolicy.CanSubmit(
            ChecklistStatus.NotStarted,
            rules,
            [new RampChecklistAnswerWriteData(
                RampExecutionTestData.ItemId,
                ChecklistAnswerValue.NotOk,
                "   ")]));
        Assert.True(RampChecklistSubmissionPolicy.CanSubmit(
            ChecklistStatus.NotStarted,
            rules,
            [new RampChecklistAnswerWriteData(
                RampExecutionTestData.ItemId,
                ChecklistAnswerValue.NotOk,
                "Seal damaged") ]));
    }

    [Theory]
    [InlineData(ServiceExecutionStatus.Planned, ServiceExecutionStatus.InProgress, true)]
    [InlineData(ServiceExecutionStatus.Planned, ServiceExecutionStatus.NotPerformed, true)]
    [InlineData(ServiceExecutionStatus.Planned, ServiceExecutionStatus.Exception, true)]
    [InlineData(ServiceExecutionStatus.Planned, ServiceExecutionStatus.Completed, false)]
    [InlineData(ServiceExecutionStatus.InProgress, ServiceExecutionStatus.Completed, true)]
    [InlineData(ServiceExecutionStatus.InProgress, ServiceExecutionStatus.NotPerformed, true)]
    [InlineData(ServiceExecutionStatus.InProgress, ServiceExecutionStatus.Exception, true)]
    [InlineData(ServiceExecutionStatus.Completed, ServiceExecutionStatus.Exception, false)]
    [InlineData(ServiceExecutionStatus.NotPerformed, ServiceExecutionStatus.InProgress, false)]
    [InlineData(ServiceExecutionStatus.Exception, ServiceExecutionStatus.InProgress, false)]
    public void ServiceTransitionMatrixFailsClosed(
        ServiceExecutionStatus current,
        ServiceExecutionStatus target,
        bool expected)
    {
        decimal? quantity = target == ServiceExecutionStatus.InProgress ? null : 0m;
        var note = target is ServiceExecutionStatus.NotPerformed or ServiceExecutionStatus.Exception
            ? "Operational reason"
            : null;

        Assert.Equal(expected, RampOperationServiceTransitionPolicy.CanTransition(
            TurnaroundStatus.Confirmed,
            GroundOperationStatus.InProgress,
            StartedAt,
            null,
            current,
            target,
            quantity,
            note));
    }

    [Fact]
    public void ServiceTerminalQuantityAndReasonRulesAreStrict()
    {
        Assert.False(RampOperationServiceTransitionPolicy.HasValidRequestShape(
            ServiceExecutionStatus.Completed,
            null,
            null));
        Assert.False(RampOperationServiceTransitionPolicy.HasValidRequestShape(
            ServiceExecutionStatus.NotPerformed,
            1m,
            "Not available"));
        Assert.False(RampOperationServiceTransitionPolicy.HasValidRequestShape(
            ServiceExecutionStatus.NotPerformed,
            0m,
            "  "));
        Assert.False(RampOperationServiceTransitionPolicy.HasValidRequestShape(
            ServiceExecutionStatus.Exception,
            0m,
            null));
        Assert.False(RampOperationServiceTransitionPolicy.HasValidRequestShape(
            ServiceExecutionStatus.Completed,
            1.00001m,
            null));
        Assert.False(RampOperationServiceTransitionPolicy.HasValidRequestShape(
            ServiceExecutionStatus.Completed,
            -1m,
            null));
        Assert.True(RampOperationServiceTransitionPolicy.HasValidRequestShape(
            ServiceExecutionStatus.Completed,
            1.25m,
            null));
    }

    [Theory]
    [InlineData(ServiceExecutionStatus.Completed)]
    [InlineData(ServiceExecutionStatus.NotPerformed)]
    [InlineData(ServiceExecutionStatus.Exception)]
    public void TerminalServiceCanRestartOnlyDuringReasonedCorrection(
        ServiceExecutionStatus previous)
    {
        Assert.False(RampOperationServiceTransitionPolicy.CanTransition(
            TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress,
            StartedAt, null, previous, ServiceExecutionStatus.InProgress,
            null, "Corrected after OCC return"));
        Assert.False(RampOperationServiceTransitionPolicy.CanTransition(
            TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress,
            StartedAt, null, previous, ServiceExecutionStatus.InProgress,
            null, "  ", isCorrectionRound: true));
        Assert.True(RampOperationServiceTransitionPolicy.CanTransition(
            TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress,
            StartedAt, null, previous, ServiceExecutionStatus.InProgress,
            null, "Corrected after OCC return", isCorrectionRound: true));
        Assert.False(RampOperationServiceTransitionPolicy.CanTransition(
            TurnaroundStatus.Confirmed, GroundOperationStatus.InProgress,
            StartedAt, null, previous, ServiceExecutionStatus.Completed,
            1m, "Corrected after OCC return", isCorrectionRound: true));
    }

    [Fact]
    public void HandoffRequiresSubmittedChecklistAndEveryServiceTerminal()
    {
        Assert.True(RampOperationSubmissionPolicy.CanSubmit(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, StartedAt, null,
            ChecklistStatus.Submitted,
            [ServiceExecutionStatus.Completed, ServiceExecutionStatus.NotPerformed]));
        Assert.False(RampOperationSubmissionPolicy.CanSubmit(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, StartedAt, null,
            ChecklistStatus.InProgress, [ServiceExecutionStatus.Completed]));
        Assert.False(RampOperationSubmissionPolicy.CanSubmit(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, StartedAt, null,
            ChecklistStatus.Submitted, [ServiceExecutionStatus.Planned]));
        Assert.False(RampOperationSubmissionPolicy.CanSubmit(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, StartedAt, null,
            ChecklistStatus.Submitted, []));
        Assert.False(RampOperationSubmissionPolicy.CanSubmit(
            TurnaroundStatus.InProgress, GroundOperationStatus.PendingReview, StartedAt, StartedAt,
            ChecklistStatus.Submitted, [ServiceExecutionStatus.Completed]));
    }

    [Fact]
    public void HandoffNoteRejectsControlsAndOversizedText()
    {
        Assert.True(RampOperationSubmissionPolicy.HasValidNote(null));
        Assert.True(RampOperationSubmissionPolicy.HasValidNote("Sin observaciones"));
        Assert.False(RampOperationSubmissionPolicy.HasValidNote(new string('x', 2001)));
        Assert.True(RampOperationSubmissionPolicy.HasValidNote("texto\nnormal"));
        Assert.False(RampOperationSubmissionPolicy.HasValidNote("texto\0inyectado"));
    }
}
