using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>3-D: the one rule of what occupies an agent and a stand (AVIAM OCC, Pillier).</summary>
public sealed class OperationOccupancyRulesTests
{
    [Theory]
    [InlineData(0, false)]
    [InlineData(1, false)]
    [InlineData(2, false)]
    [InlineData(3, true)]
    [InlineData(4, true)]
    public void AnAgentCarriesUpToThreeSimultaneousOperations(int overlapping, bool atCapacity)
    {
        Assert.Equal(atCapacity, OperationOccupancyRules.AtCapacity(overlapping));
    }

    [Theory]
    [InlineData(GroundOperationStatus.Planned, TurnaroundStatus.Confirmed, true)]
    [InlineData(GroundOperationStatus.Assigned, TurnaroundStatus.Confirmed, true)]
    [InlineData(GroundOperationStatus.InProgress, TurnaroundStatus.InProgress, true)]
    [InlineData(GroundOperationStatus.PendingReview, TurnaroundStatus.InProgress, true)]
    [InlineData(GroundOperationStatus.InReview, TurnaroundStatus.InProgress, true)]
    [InlineData(GroundOperationStatus.Returned, TurnaroundStatus.InProgress, true)]
    [InlineData(GroundOperationStatus.Approved, TurnaroundStatus.InProgress, false)]
    [InlineData(GroundOperationStatus.Cancelled, TurnaroundStatus.Cancelled, false)]
    [InlineData(GroundOperationStatus.Assigned, TurnaroundStatus.Completed, false)]
    [InlineData(GroundOperationStatus.Planned, TurnaroundStatus.Cancelled, false)]
    [InlineData(GroundOperationStatus.Planned, TurnaroundStatus.Diverted, false)]
    public void AnApprovedOrClosedFlightNoLongerHoldsItsStand(GroundOperationStatus operation, TurnaroundStatus turnaround,
        bool holds)
    {
        Assert.Equal(holds, OperationOccupancyRules.HoldsStand(operation, turnaround));
    }

    /// <summary>
    /// Owner decision 23: the recorded push-back frees the stand, whatever the operation's status; the assignment stays
    /// open, so this rule is the occupancy's alone.
    /// </summary>
    [Fact]
    public void AStandIsFreeOnceThePushbackIsRecorded()
    {
        Assert.False(OperationOccupancyRules.HasLeftStand(null));
        var pushedBackAt = new DateTimeOffset(2026, 11, 13, 14, 50, 0, TimeSpan.Zero);
        Assert.True(OperationOccupancyRules.HasLeftStand(pushedBackAt));
        // A corrected time, earlier or later, is still a push-back.
        Assert.True(OperationOccupancyRules.HasLeftStand(pushedBackAt.AddMinutes(-5)));
        Assert.True(OperationOccupancyRules.HasLeftStand(pushedBackAt.AddMinutes(5)));
    }

    [Fact]
    public void AnOperationStartsWhenTheAgentPressesStart()
    {
        Assert.False(OperationOccupancyRules.HasStarted(null));
        Assert.True(OperationOccupancyRules.HasStarted(DateTimeOffset.UtcNow));
    }

    [Theory]
    [InlineData(GroundOperationStatus.PendingReview)]
    [InlineData(GroundOperationStatus.InReview)]
    [InlineData(GroundOperationStatus.Approved)]
    [InlineData(GroundOperationStatus.Cancelled)]
    [InlineData(GroundOperationStatus.Planned)]
    public void AHandedOverApprovedOrUnassignedOperationFreesItsAgent(GroundOperationStatus status)
    {
        Assert.False(OperationOccupancyRules.HoldsAgent(status));
    }
}
