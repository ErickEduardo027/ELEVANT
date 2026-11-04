using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class FlightReportTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 4, 16, 0, 0, TimeSpan.Zero);

    [Fact]
    public void TheCatalogFollowsTheFormAndHasUniqueCodes()
    {
        Assert.Equal(25, FlightReportMilestones.All.Count);
        Assert.Equal(FlightReportMilestones.All.Count, FlightReportMilestones.All.Select(item => item.Code).Distinct().Count());
        Assert.Equal(Enumerable.Range(1, 25), FlightReportMilestones.All.Select(item => item.SortOrder));
        Assert.Equal("BLOCK_ON", FlightReportMilestones.All[0].Code);
        Assert.Equal("PUSHBACK", FlightReportMilestones.All[^1].Code);
        Assert.True(FlightReportMilestones.IsKnown("DNCD"));
        Assert.False(FlightReportMilestones.IsKnown("block_on"));
        Assert.All(IataDelayCodes.All, code => Assert.Matches("^[0-9]{2}$", code.Code));
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(-23, true)]
    [InlineData(-25, false)]
    [InlineData(1, false)]
    public void AMilestoneIsAcceptedWithinTheOfflineWindow(int hours, bool expected) =>
        Assert.Equal(expected, RampExecutionPolicy.CanRecordMilestone(TurnaroundStatus.InProgress,
            GroundOperationStatus.InProgress, Now.AddHours(-30), null, Now.AddHours(hours), Now));

    [Fact]
    public void MilestonesNeedAStartedOperationThatIsNotSubmitted()
    {
        Assert.False(RampExecutionPolicy.CanRecordMilestone(TurnaroundStatus.InProgress, GroundOperationStatus.Assigned,
            null, null, Now, Now));
        Assert.False(RampExecutionPolicy.CanRecordMilestone(TurnaroundStatus.InProgress, GroundOperationStatus.PendingReview,
            Now.AddHours(-1), Now, Now, Now));
    }

    [Theory]
    [InlineData(150, 148, 78_000, "HI1055", true)]
    [InlineData(null, null, null, null, true)]
    [InlineData(1000, 0, null, null, false)]
    [InlineData(0, 0, 500, null, false)]
    [InlineData(0, 0, null, "hi 1055", false)]
    public void FlightDataHasPlausibleRanges(int? passengersIn, int? passengersOut, int? mtowKg, string? registration,
        bool expected) =>
        Assert.Equal(expected, RampExecutionPolicy.HasValidFlightData(passengersIn, passengersOut, mtowKg, registration));

    [Fact]
    public void ADeviationCarriesAKnownIataDelayCodeAndOtherIncidentsNone()
    {
        Assert.True(RampIncidentPolicy.IsValid("Deviation", IncidentSeverity.Medium, "GPU tarde en la posición", Now, "34"));
        Assert.False(RampIncidentPolicy.IsValid("Deviation", IncidentSeverity.Medium, "GPU tarde en la posición", Now, null));
        Assert.False(RampIncidentPolicy.IsValid("Deviation", IncidentSeverity.Medium, "GPU tarde en la posición", Now, "00"));
        Assert.False(RampIncidentPolicy.IsValid("Safety", IncidentSeverity.High, "Derrame de combustible", Now, "34"));
        Assert.True(RampIncidentPolicy.IsValid("Safety", IncidentSeverity.High, "Derrame de combustible", Now));
    }
}
