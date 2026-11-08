using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

/// <summary>Who worked an operation and for how long (3-N14).</summary>
public sealed class OperationWorkAttributionTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 5, 13, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset End = Start.AddMinutes(75);

    private static OperationWorkAttribution.Assignment Assigned(long agent, DateTimeOffset at, DateTimeOffset? released = null) =>
        new(agent, at, released);

    [Fact]
    public void AnAgentReleasedBeforeTheStartNeverWorkedTheOperation()
    {
        // The airport moved the stand: the flight followed the agent covering the new one before it started.
        var work = OperationWorkAttribution.Attribute(
            [Assigned(1, Start.AddHours(-3), Start.AddMinutes(-30)), Assigned(2, Start.AddMinutes(-30))], Start, End);

        Assert.Equal([new OperationWorkAttribution.AgentWork(2, 75m)], work);
    }

    [Fact]
    public void AHandoverSplitsTheMinutesBetweenBothAgents()
    {
        var handover = Start.AddMinutes(30);
        var work = OperationWorkAttribution.Attribute(
            [Assigned(1, Start.AddHours(-2), handover), Assigned(2, handover)], Start, End);

        Assert.Equal([new OperationWorkAttribution.AgentWork(1, 30m), new OperationWorkAttribution.AgentWork(2, 45m)], work);
    }

    [Fact]
    public void AnApprovedOperationKeepsEveryMinuteOfItsOpenOrLaterClosedAssignment()
    {
        // The approval releases nobody (3-D): the open assignment runs to the end; one closed after it is cut there.
        Assert.Equal([new OperationWorkAttribution.AgentWork(1, 75m)],
            OperationWorkAttribution.Attribute([Assigned(1, Start.AddHours(-2))], Start, End));
        Assert.Equal([new OperationWorkAttribution.AgentWork(1, 75m)],
            OperationWorkAttribution.Attribute([Assigned(1, Start.AddHours(-2), End.AddHours(4))], Start, End));
    }

    [Fact]
    public void AnOperationNotStartedBelongsToItsCurrentAgentWithoutMinutes()
    {
        var work = OperationWorkAttribution.Attribute(
            [Assigned(1, Start.AddHours(-3), Start.AddHours(-2)), Assigned(2, Start.AddHours(-2))], null, null);

        Assert.Equal([new OperationWorkAttribution.AgentWork(2, 0m)], work);
    }

    [Fact]
    public void AMentorAndTheAgentUnderThreeMonthsBothGetTheMinutesTheyShared()
    {
        var work = OperationWorkAttribution.Attribute(
            [Assigned(7, Start.AddHours(-1)), Assigned(3, Start.AddHours(-1))], Start, End);

        Assert.Equal([new OperationWorkAttribution.AgentWork(3, 75m), new OperationWorkAttribution.AgentWork(7, 75m)], work);
    }

    [Fact]
    public void AStartedOperationWithoutAnEndCountsItsAgentsWithoutMinutes()
    {
        var handover = Start.AddMinutes(20);
        var work = OperationWorkAttribution.Attribute(
            [Assigned(1, Start.AddHours(-1), handover), Assigned(2, handover), Assigned(4, Start.AddHours(-2), Start)],
            Start, null);

        Assert.Equal([new OperationWorkAttribution.AgentWork(1, 0m), new OperationWorkAttribution.AgentWork(2, 0m)], work);
    }

    [Fact]
    public void AnAgentHandedTheOperationBackIsCountedOnceOverBothStretches()
    {
        var first = Start.AddMinutes(20);
        var back = Start.AddMinutes(50);
        var work = OperationWorkAttribution.Attribute(
            [Assigned(1, Start.AddHours(-1), first), Assigned(2, first, back), Assigned(1, back)], Start, End);

        Assert.Equal([new OperationWorkAttribution.AgentWork(1, 45m), new OperationWorkAttribution.AgentWork(2, 30m)], work);
    }

    [Fact]
    public void AnAgentWhoTookOverAfterTheEndCountsTheCorrectionWithoutMinutes()
    {
        // Returned for correction after the first hand-off: the operation keeps that end (3-N09), the new agent corrects.
        var work = OperationWorkAttribution.Attribute(
            [Assigned(1, Start.AddHours(-1), End.AddHours(2)), Assigned(2, End.AddHours(2))], Start, End);

        Assert.Equal([new OperationWorkAttribution.AgentWork(1, 75m), new OperationWorkAttribution.AgentWork(2, 0m)], work);
    }
}
