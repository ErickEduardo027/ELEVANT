using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>Phase 3, block C: the one rule of «when is a tablet time valid» (3-I, 3-N06, 3-N09, 3-N25).</summary>
public sealed class RampEvidenceTimePolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 7, 18, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(-30, true)]
    [InlineData(-62, true)]
    [InlineData(-63, false)]
    [InlineData(2, true)]
    [InlineData(3, false)]
    public void AStartFollowsItsAssignmentAndIsNeverInTheFuture(int minutes, bool expected) =>
        Assert.Equal(expected, RampEvidenceTimePolicy.CheckStart(Now.AddMinutes(minutes), Now.AddHours(-1), Now));

    [Fact]
    public void AStartWaitsInTheOfflineQueueAtMostADay()
    {
        var assignedTwoDaysAgo = Now.AddDays(-2);
        Assert.True(RampEvidenceTimePolicy.CheckStart(Now.AddHours(-23), assignedTwoDaysAgo, Now));
        Assert.False(RampEvidenceTimePolicy.CheckStart(Now.AddHours(-25), assignedTwoDaysAgo, Now));
    }

    [Fact]
    public void TheWindowOpensAtTheStartOrTheEarlierRecordedArrival()
    {
        var start = Now.AddHours(-2);
        var withoutArrival = RampEvidenceTimePolicy.WindowFor(start, null, null, Now);
        Assert.Equal(start - RampEvidenceTimePolicy.ClockTolerance, withoutArrival.Opens);
        Assert.Equal(Now + RampEvidenceTimePolicy.ClockTolerance, withoutArrival.Closes);

        // The agent tapped «Iniciar» late: the block-on of the aircraft that arrived before still counts.
        var arrival = start.AddMinutes(-20);
        var withArrival = RampEvidenceTimePolicy.WindowFor(start, arrival, null, Now);
        Assert.Equal(arrival - RampEvidenceTimePolicy.ClockTolerance, withArrival.Opens);
        Assert.True(withArrival.Contains(arrival.AddMinutes(5)));
        Assert.Equal(start - RampEvidenceTimePolicy.ClockTolerance,
            RampEvidenceTimePolicy.WindowFor(start, start.AddMinutes(10), null, Now).Opens);
    }

    [Fact]
    public void ThereIsNoFixedDayLimitAndACorrectionRoundClosesTheMilestonesAtTheFirstHandOff()
    {
        var saturday = Now.AddHours(-50);
        var firstHandOff = saturday.AddHours(3);
        var correction = RampEvidenceTimePolicy.WindowFor(saturday, null,
            RampEvidenceTimePolicy.ClosedAt(RampEvidenceKind.Milestone, GroundOperationStatus.InProgress, null,
                firstHandOff, firstHandOff), Now);

        Assert.True(correction.Contains(saturday.AddHours(2)));
        Assert.Equal(firstHandOff + RampEvidenceTimePolicy.ClockTolerance, correction.Closes);
        Assert.Null(RampEvidenceTimePolicy.CheckEvidence(saturday.AddHours(2), correction));
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            RampEvidenceTimePolicy.CheckEvidence(firstHandOff.AddMinutes(3), correction));
    }

    [Fact]
    public void ACorrectionRoundTakesUntilNowTheDamagesAndIncidentsTheAgentRecordsInIt()
    {
        // The tablet records a damage, an incident or a deviation with the current time and no time picker: OCC may
        // return the operation precisely to have one added.
        var saturday = Now.AddHours(-50);
        var firstHandOff = saturday.AddHours(3);
        var closedAt = RampEvidenceTimePolicy.ClosedAt(RampEvidenceKind.Report, GroundOperationStatus.InProgress, null,
            firstHandOff, firstHandOff);
        Assert.Null(closedAt);
        var correction = RampEvidenceTimePolicy.WindowFor(saturday, null, closedAt, Now);

        Assert.Null(RampEvidenceTimePolicy.CheckEvidence(Now, correction));
        Assert.Null(RampEvidenceTimePolicy.CheckEvidence(saturday.AddHours(2), correction));
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            RampEvidenceTimePolicy.CheckEvidence(Now.AddMinutes(3), correction));
        Assert.True(RampIncidentPolicy.CanReport(TurnaroundStatus.InProgress, GroundOperationStatus.InProgress,
            saturday, null, Now, correction));
        Assert.Null(RampExecutionPolicy.MilestoneRejection(TurnaroundStatus.InProgress, GroundOperationStatus.InProgress,
            saturday, null, string.Empty, Now, correction, new Dictionary<string, DateTimeOffset>(), Now));
    }

    [Fact]
    public void UnderReviewOfAResubmissionAMilestoneClosesAtTheFirstHandOffAndAReportAtTheResubmission()
    {
        var firstHandOff = Now.AddHours(-48);
        var resubmittedAt = Now.AddMinutes(-20);
        // The resubmission keeps the first hand-off as the operation's end (3-N09).
        Assert.Equal(firstHandOff, RampEvidenceTimePolicy.ClosedAt(RampEvidenceKind.Milestone,
            GroundOperationStatus.PendingReview, firstHandOff, firstHandOff, resubmittedAt));
        // A damage marked during the correction that reaches ELEVANT after the resubmission is still taken (3-N06).
        Assert.Equal(resubmittedAt, RampEvidenceTimePolicy.ClosedAt(RampEvidenceKind.Report,
            GroundOperationStatus.PendingReview, firstHandOff, firstHandOff, resubmittedAt));
    }

    [Fact]
    public void UnderReviewTheWindowClosesAtTheHandOffAndOtherwiseItIsStillOpen()
    {
        var handOff = Now.AddMinutes(-30);
        foreach (var kind in Enum.GetValues<RampEvidenceKind>())
        {
            Assert.Equal(handOff, RampEvidenceTimePolicy.ClosedAt(kind, GroundOperationStatus.PendingReview, handOff,
                handOff, handOff));
            Assert.Null(RampEvidenceTimePolicy.ClosedAt(kind, GroundOperationStatus.InProgress, null, null, null));
        }
        var review = RampEvidenceTimePolicy.WindowFor(Now.AddHours(-2), null, handOff, Now);
        Assert.True(review.Contains(handOff.AddMinutes(-10)));
        Assert.False(review.Contains(handOff.AddMinutes(10)));
        // A close in the future never extends beyond now plus the tolerance.
        Assert.Equal(Now + RampEvidenceTimePolicy.ClockTolerance,
            RampEvidenceTimePolicy.WindowFor(Now.AddHours(-2), null, Now.AddHours(1), Now).Closes);
    }

    [Fact]
    public void AServiceTransitionFitsTheOpeningAndFollowsTheServiceLastTransition()
    {
        var opens = Now.AddHours(-2);
        var last = Now.AddMinutes(-40);
        Assert.Null(RampEvidenceTimePolicy.CheckServiceTime(Now.AddMinutes(-25), opens, last, Now));
        Assert.Null(RampEvidenceTimePolicy.CheckServiceTime(Now.AddMinutes(-25), opens, null, Now));
        Assert.Equal(RampProblemCodes.ServiceTimeOutOfOrder,
            RampEvidenceTimePolicy.CheckServiceTime(Now.AddMinutes(-41), opens, last, Now));
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            RampEvidenceTimePolicy.CheckServiceTime(opens.AddSeconds(-1), opens, null, Now));
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow,
            RampEvidenceTimePolicy.CheckServiceTime(Now.AddMinutes(3), opens, null, Now));
    }

    [Fact]
    public void BlockOnNeverComesAfterPushbackAndTheOtherMilestonesAreNotOrdered()
    {
        var recorded = new Dictionary<string, DateTimeOffset>
        {
            [RampEvidenceTimePolicy.Pushback] = Now.AddMinutes(-10),
            ["DNCD"] = Now.AddMinutes(-50),
        };
        Assert.True(RampEvidenceTimePolicy.IsInOrder(RampEvidenceTimePolicy.BlockOn, Now.AddMinutes(-60), recorded));
        Assert.True(RampEvidenceTimePolicy.IsInOrder(RampEvidenceTimePolicy.BlockOn, Now.AddMinutes(-10), recorded));
        Assert.False(RampEvidenceTimePolicy.IsInOrder(RampEvidenceTimePolicy.BlockOn, Now.AddMinutes(-5), recorded));
        Assert.True(RampEvidenceTimePolicy.IsInOrder("DNCD", Now, recorded));

        var blockOn = new Dictionary<string, DateTimeOffset> { [RampEvidenceTimePolicy.BlockOn] = Now.AddMinutes(-60) };
        Assert.False(RampEvidenceTimePolicy.IsInOrder(RampEvidenceTimePolicy.Pushback, Now.AddMinutes(-61), blockOn));
        Assert.True(RampEvidenceTimePolicy.IsInOrder(RampEvidenceTimePolicy.Pushback, Now, blockOn));
        Assert.True(RampEvidenceTimePolicy.IsInOrder(RampEvidenceTimePolicy.Pushback, Now, new Dictionary<string, DateTimeOffset>()));
    }

    [Fact]
    public void NothingIsStoredInTheFuture()
    {
        Assert.Equal(Now, RampEvidenceTimePolicy.Clamp(Now.AddMinutes(1), Now));
        Assert.Equal(Now.AddMinutes(-1), RampEvidenceTimePolicy.Clamp(Now.AddMinutes(-1), Now));
    }

    [Fact]
    public void AMilestoneNamesTheRuleItBreaks()
    {
        var start = Now.AddHours(-3);
        var window = RampEvidenceTimePolicy.WindowFor(start, null, null, Now);
        var pushback = new Dictionary<string, DateTimeOffset> { [RampEvidenceTimePolicy.Pushback] = Now.AddMinutes(-30) };

        Assert.Null(RampExecutionPolicy.MilestoneRejection(TurnaroundStatus.InProgress, GroundOperationStatus.InProgress,
            start, null, RampEvidenceTimePolicy.BlockOn, Now.AddHours(-2), window, pushback, Now));
        Assert.Equal(RampProblemCodes.MilestoneOutOfOrder, RampExecutionPolicy.MilestoneRejection(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, start, null, RampEvidenceTimePolicy.BlockOn,
            Now.AddMinutes(-20), window, pushback, Now));
        Assert.Equal(RampProblemCodes.TimeOutsideOperationWindow, RampExecutionPolicy.MilestoneRejection(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress, start, null, RampEvidenceTimePolicy.BlockOn,
            start.AddMinutes(-10), window, pushback, Now));
        Assert.Equal(RampProblemCodes.GenericConflict, RampExecutionPolicy.MilestoneRejection(
            TurnaroundStatus.InProgress, GroundOperationStatus.Approved, start, Now.AddMinutes(-5),
            RampEvidenceTimePolicy.BlockOn, Now.AddHours(-2), window, pushback, Now));
    }

    [Fact]
    public void AHandedOffOperationTakesLateEvidenceUntilOccDecides()
    {
        var start = Now.AddHours(-2);
        var handOff = Now.AddMinutes(-15);
        Assert.True(RampOperationExecutionPolicy.AcceptsLateEvidence(GroundOperationStatus.PendingReview, start, handOff));
        Assert.False(RampOperationExecutionPolicy.AcceptsLateEvidence(GroundOperationStatus.Approved, start, handOff));
        Assert.False(RampOperationExecutionPolicy.AcceptsLateEvidence(GroundOperationStatus.PendingReview, start, null));
        Assert.True(RampExecutionPolicy.CanUpdateFlightData(TurnaroundStatus.InProgress,
            GroundOperationStatus.PendingReview, start, handOff));
        Assert.False(RampExecutionPolicy.CanUpdateFlightData(TurnaroundStatus.InProgress,
            GroundOperationStatus.Approved, start, handOff));
    }
}
