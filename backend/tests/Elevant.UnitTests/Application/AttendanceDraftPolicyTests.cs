using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

public sealed class AttendanceDraftPolicyTests
{
    private static readonly DateTimeOffset Started =
        new(2026, 10, 2, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void RequiresNonnegativeExpectedRevisionAndMeaningfulObservation()
    {
        Assert.False(AttendanceDraftPolicy.IsValid(-1, Started, null, null));
        Assert.False(AttendanceDraftPolicy.IsValid(0, null, null, null));
        Assert.False(AttendanceDraftPolicy.IsValid(0, null, null, " \t\n "));
        Assert.True(AttendanceDraftPolicy.IsValid(0, Started, null, null));
        Assert.True(AttendanceDraftPolicy.IsValid(2, null, null, "Retraso en rampa"));
    }

    [Fact]
    public void RejectsReverseChronologyAndInvalidInstants()
    {
        Assert.False(AttendanceDraftPolicy.IsValid(0, Started.AddHours(1), Started, null));
        Assert.False(AttendanceDraftPolicy.IsValid(0, default(DateTimeOffset), null, null));
        Assert.True(AttendanceDraftPolicy.IsValid(0, Started, Started.AddHours(1), null));
    }

    [Fact]
    public void BoundsAndNormalizesNotesWithoutControlCharacters()
    {
        Assert.True(AttendanceDraftPolicy.IsValid(0, null, null, $"  {new string('x', 2000)}  "));
        Assert.Equal("Observación", AttendanceDraftPolicy.NormalizeNote("  Observación  "));
        Assert.False(AttendanceDraftPolicy.IsValid(0, null, null, new string('x', 2001)));
        Assert.False(AttendanceDraftPolicy.IsValid(0, null, null, "Falla\0visible"));
        Assert.True(AttendanceDraftPolicy.IsValid(0, null, null, "Falla\nvisible"));
    }

    [Fact]
    public void AcceptsOnlyTwoDistinctContributorLanes()
    {
        Assert.NotEqual(AttendanceDraftLane.Occ, AttendanceDraftLane.RampAgent);
        Assert.True(AttendanceDraftPolicy.IsValidLane(AttendanceDraftLane.Occ));
        Assert.True(AttendanceDraftPolicy.IsValidLane(AttendanceDraftLane.RampAgent));
        Assert.False(AttendanceDraftPolicy.IsValidLane((AttendanceDraftLane)99));
    }
}
