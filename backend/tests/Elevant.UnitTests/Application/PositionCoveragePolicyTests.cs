using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class PositionCoveragePolicyTests
{
    private static readonly DateOnly WorkDate = new(2026, 11, 7);
    private static readonly DateTimeOffset Start = new(2026, 11, 7, 10, 0, 0, TimeSpan.Zero);

    private static CoverageStandFacts Stand(string code, bool bridge = false) =>
        new(Guid.NewGuid(), code, true, true, bridge);

    private static PositionCoverageCandidate Candidate(int stands = 2, bool requiresBridge = false, int max = 3) => new(
        Start, Start.AddHours(8), WorkDate, new CoverageTerminalRules(max, requiresBridge),
        Enumerable.Range(1, stands).Select(index => Stand($"A0{index}")).ToArray(),
        new CoverageAgentFacts(true, new DateOnly(2025, 1, 1), true, false, false, true, false, false),
        null, null, false, []);

    [Fact]
    public void TwoStandsInTerminalAWithAShiftAndPermitsAreAccepted() =>
        Assert.Empty(PositionCoveragePolicy.Evaluate(Candidate()));

    [Fact]
    public void ThreeStandsNeedADrivingLicenceAndAVehicle()
    {
        var candidate = Candidate(stands: 3);
        Assert.Equal(["driver_license_required", "vehicle_required"], PositionCoveragePolicy.Evaluate(candidate));
        var ready = candidate with { VehicleCode = "VH-07", Agent = candidate.Agent with { HasDriverLicense = true } };
        Assert.Empty(PositionCoveragePolicy.Evaluate(ready));
    }

    [Fact]
    public void TheTerminalMaximumIsConfigurable()
    {
        // Terminal B: at most two stands per agent.
        Assert.Contains("too_many_stands", PositionCoveragePolicy.Evaluate(Candidate(stands: 3, max: 2)));
        Assert.DoesNotContain("too_many_stands", PositionCoveragePolicy.Evaluate(Candidate(stands: 1, max: 1)));
    }

    [Fact]
    public void TerminalBOrABridgeStandNeedTheBridgeQualification()
    {
        Assert.Contains("bridge_qualification_required", PositionCoveragePolicy.Evaluate(Candidate(requiresBridge: true)));
        var bridgeStand = Candidate() with { Stands = [Stand("B10", bridge: true)] };
        Assert.Contains("bridge_qualification_required", PositionCoveragePolicy.Evaluate(bridgeStand));
        var qualified = bridgeStand with { Agent = bridgeStand.Agent with { HasBridgeQualification = true } };
        Assert.Empty(PositionCoveragePolicy.Evaluate(qualified));
    }

    [Fact]
    public void AnAgentWithLessThanThreeMonthsNeedsASeniorMentor()
    {
        var junior = Candidate() with { Agent = Candidate().Agent with { HireDate = WorkDate.AddMonths(-2) } };
        Assert.Equal(["mentor_required"], PositionCoveragePolicy.Evaluate(junior));
        var withMentor = junior with { Mentor = new CoverageMentorFacts(true, new DateOnly(2024, 5, 1), true) };
        Assert.Empty(PositionCoveragePolicy.Evaluate(withMentor));
        var juniorMentor = junior with { Mentor = new CoverageMentorFacts(true, WorkDate.AddMonths(-1), true) };
        Assert.Equal(["mentor_not_eligible"], PositionCoveragePolicy.Evaluate(juniorMentor));
    }

    [Fact]
    public void AMentorOnAnApprovedAbsenceOrWithoutAnAirportPermitAccompaniesNobody()
    {
        // 2-N23: the trainee never works alone because the mentor is off or has an expired permit.
        var junior = Candidate() with { Agent = Candidate().Agent with { HireDate = WorkDate.AddMonths(-1) } };
        var absent = junior with { Mentor = new CoverageMentorFacts(true, new DateOnly(2024, 5, 1), true, HasApprovedAbsence: true) };
        Assert.Equal(["mentor_absent"], PositionCoveragePolicy.Evaluate(absent));
        var withoutPermit = junior with { Mentor = new CoverageMentorFacts(true, new DateOnly(2024, 5, 1), true, HasAirportPermit: false) };
        Assert.Equal(["mentor_permit_required"], PositionCoveragePolicy.Evaluate(withoutPermit));
        var both = junior with { Mentor = new CoverageMentorFacts(false, new DateOnly(2024, 5, 1), true, true, false) };
        Assert.Equal(["mentor_not_eligible", "mentor_absent", "mentor_permit_required"], PositionCoveragePolicy.Evaluate(both));
    }

    [Fact]
    public void ACoverageNeedsTheAgentsScopeInItsTerminal()
    {
        // 3-N05: the tablet only lets the agent work stands of a terminal they have a current scope in.
        var outOfScope = Candidate() with { Agent = Candidate().Agent with { HasTerminalScope = false } };
        Assert.Equal(["terminal_scope_missing"], PositionCoveragePolicy.Evaluate(outOfScope));
    }

    [Theory]
    [InlineData(-3, false)]
    [InlineData(-2, true)]
    public void SeniorityCountsThreeFullMonths(int months, bool junior) =>
        Assert.Equal(junior, PositionCoveragePolicy.IsJunior(WorkDate.AddMonths(months), WorkDate));

    [Fact]
    public void TheShiftMustCoverTheWholeWindowAndAbsencesBlock()
    {
        var candidate = Candidate() with
        {
            Agent = Candidate().Agent with { ShiftCoversWindow = false, HasApprovedAbsence = true, HasAirportPermit = false },
        };
        Assert.Equal(["airport_permit_required", "shift_not_covering", "absent"], PositionCoveragePolicy.Evaluate(candidate));
    }

    [Fact]
    public void ACoveredStandIsOnlySharedByAMentorPairOrAReinforcement()
    {
        var taken = Candidate() with { Overlaps = [new CoverageStandOverlap(Guid.NewGuid(), "A01", false)] };
        Assert.Equal(["stand_taken"], PositionCoveragePolicy.Evaluate(taken));
        Assert.Empty(PositionCoveragePolicy.Evaluate(taken with { IsReinforcement = true }));
        var mentorPair = Candidate() with { Overlaps = [new CoverageStandOverlap(Guid.NewGuid(), "A01", true)] };
        Assert.Empty(PositionCoveragePolicy.Evaluate(mentorPair));
    }

    [Fact]
    public void TheWindowMustBePositiveAndAtMostSixteenHours()
    {
        Assert.Contains("window_invalid", PositionCoveragePolicy.Evaluate(Candidate() with { EndsAt = Start }));
        Assert.Contains("window_invalid", PositionCoveragePolicy.Evaluate(Candidate() with { EndsAt = Start.AddHours(17) }));
        Assert.Equal(["no_stands"], PositionCoveragePolicy.Evaluate(Candidate(stands: 0)));
    }
}

public sealed class StandConstraintPolicyTests
{
    // 9A (1) and 11A (3) cancel 10 (2); 23A (4) limits 25 (5) to narrow-body.
    private static readonly StandRule[] Rules =
    [
        new(1, 2, StandConstraintKind.Cancels),
        new(3, 2, StandConstraintKind.Cancels),
        new(4, 5, StandConstraintKind.NarrowbodyOnly),
    ];

    [Fact]
    public void AnOccupiedCombinedStandCancelsItsNeighbourBothWays()
    {
        var with9A = new[] { new OccupiedStand(1, "9A", AircraftSizeCategory.Widebody) };
        Assert.Equal(["stand_cancelled"], StandConstraintPolicy.Evaluate(new StandPlacement(2, "10", null, null), with9A, Rules));
        var with10 = new[] { new OccupiedStand(2, "10", AircraftSizeCategory.Narrowbody) };
        Assert.Equal(["stand_cancelled"], StandConstraintPolicy.Evaluate(new StandPlacement(1, "9A", null, null), with10, Rules));
        Assert.Empty(StandConstraintPolicy.Evaluate(new StandPlacement(2, "10", null, null), [], Rules));
    }

    [Fact]
    public void ANarrowbodyLimitOnlyStopsWidebodies()
    {
        var with23A = new[] { new OccupiedStand(4, "23A", AircraftSizeCategory.Narrowbody) };
        Assert.Equal(["stand_narrowbody_only"], StandConstraintPolicy.Evaluate(
            new StandPlacement(5, "25", null, AircraftSizeCategory.Widebody), with23A, Rules));
        Assert.Empty(StandConstraintPolicy.Evaluate(new StandPlacement(5, "25", null, AircraftSizeCategory.Narrowbody), with23A, Rules));
        Assert.Equal(["stand_narrowbody_only"], StandConstraintPolicy.Evaluate(
            new StandPlacement(26, "26A", AircraftSizeCategory.Narrowbody, AircraftSizeCategory.Widebody), [], Rules));
        var wideOn25 = new[] { new OccupiedStand(5, "25", AircraftSizeCategory.Widebody) };
        Assert.Equal(["neighbour_widebody"], StandConstraintPolicy.Evaluate(new StandPlacement(4, "23A", null, null), wideOn25, Rules));
    }

    [Fact]
    public void TheMapShowsCancelledAndLimitedStands()
    {
        var occupied = new[] { new OccupiedStand(3, "11A", null), new OccupiedStand(4, "23A", null) };
        Assert.Equal("11A", StandConstraintPolicy.CancelledStands(occupied, Rules)[2]);
        Assert.Contains(5L, StandConstraintPolicy.NarrowbodyLimited(occupied, Rules));
    }
}
