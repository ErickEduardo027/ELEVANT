using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Application.Operations.DemoStation;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041, owner decision 22, contracts 1.1: a demo flight is only sent to a stand the map knows, free during the
/// visit and covered at the on-block instant by an agent who passes OCC's real assignment rule.
/// </summary>
public sealed class DemoStandEligibilityTests
{
    private static OccAgentCandidateData Candidate(int number) => new(
        Guid.Parse($"51000000-0000-7000-8000-00000000000{number}"), $"Agente {number}", $"DEV-RA-00{number}",
        IsActive: true, HasMobileAccount: true, HasStationScope: true, HasTerminalScope: true,
        HasCurrentQualification: true, HasCurrentAirportId: true, HasCurrentRampDriverLicense: true,
        HasCompatibleShift: true, OperationalPositionId: Guid.Parse("52000000-0000-7000-8000-000000000001"),
        HasAssignmentConflict: false);

    /// <summary>A covering agent as the assignment rule judges them.</summary>
    private static OccAgentOptionData Agent(int number, Func<OccAgentCandidateData, OccAgentCandidateData>? change = null) =>
        OccAgentEligibilityPolicy.Evaluate(change is null ? Candidate(number) : change(Candidate(number)));

    private static OccAgentOptionData OffShift(int number) =>
        Agent(number, candidate => candidate with { HasCompatibleShift = false, OperationalPositionId = null });

    /// <summary>A stand of the options, filled as the store does it.</summary>
    private static DemoStandOptionData Option(string code, bool located, bool free, params OccAgentOptionData[] covering)
    {
        var (eligible, eligibleAgents, reasons) = DemoStandEligibility.Evaluate(located, free, covering);
        return new DemoStandOptionData(Guid.NewGuid(), code, "A", located, free,
            covering.Select(agent => agent.DisplayName).ToArray(), eligibleAgents, eligible, reasons);
    }

    private static void AssertVerdict((bool Eligible, int EligibleAgents, IReadOnlyList<string> Reasons) verdict,
        bool eligible, int eligibleAgents, params string[] reasons)
    {
        Assert.Equal((eligible, eligibleAgents), (verdict.Eligible, verdict.EligibleAgents));
        Assert.Equal(reasons, verdict.Reasons);
    }

    private static void AssertWarnings(IReadOnlyList<DemoFlightWarningData> warnings,
        params (string Code, string[] Reasons)[] expected)
    {
        Assert.Equal(expected.Select(item => item.Code), warnings.Select(warning => warning.Code));
        Assert.All(expected.Zip(warnings), pair => Assert.Equal(pair.First.Reasons, pair.Second.Reasons));
    }

    [Fact]
    public void AStandIsEligibleOnlyWhenLocatedFreeAndACoveringAgentPasses()
    {
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, [Agent(1)]), true, 1);
        // One agent who passes is enough; each one who does is counted.
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, [OffShift(2), Agent(1)]), true, 1);
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, [Agent(1), Agent(3)]), true, 2);

        // A stand the map does not know, or that the visit cannot take, is never eligible; its flags explain why.
        AssertVerdict(DemoStandEligibility.Evaluate(false, true, [Agent(1)]), false, 1);
        AssertVerdict(DemoStandEligibility.Evaluate(true, false, [Agent(1)]), false, 1);
        AssertVerdict(DemoStandEligibility.Evaluate(false, false, [Agent(1)]), false, 1);
        // Covered only by agents the rule refuses.
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, [OffShift(2)]), false, 0, "shift_not_compatible");
    }

    [Fact]
    public void AStandNobodyCoversSaysStandNotCovered()
    {
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, []), false, 0, "stand_not_covered");
        Assert.Equal("stand_not_covered", DemoFlightCodes.StandNotCovered);
        // Unknown to the map or taken: the flags explain it before the coverage does.
        AssertVerdict(DemoStandEligibility.Evaluate(false, true, []), false, 0);
        AssertVerdict(DemoStandEligibility.Evaluate(true, false, []), false, 0);
    }

    [Fact]
    public void TheReasonsAreThePolicyCodesOfTheCoveringAgents()
    {
        var withoutAirportId = Agent(1, candidate => candidate with
        {
            HasCurrentAirportId = false, HasCompatibleShift = false, OperationalPositionId = null,
        });
        var busyWithoutTablet = Agent(2, candidate => candidate with
        {
            HasMobileAccount = false, HasAssignmentConflict = true, HasCompatibleShift = false, OperationalPositionId = null,
        });
        var junior = Agent(3, candidate => candidate with { RequiresMentor = true });
        Assert.Equal(["airport_id_not_current", "shift_not_compatible"], withoutAirportId.EligibilityReasons);
        Assert.Equal(["mobile_account_unavailable", "shift_not_compatible", "assignment_conflict"],
            busyWithoutTablet.EligibilityReasons);
        Assert.Equal(["mentor_required"], junior.EligibilityReasons);
        string[] expected =
            ["mobile_account_unavailable", "airport_id_not_current", "shift_not_compatible", "mentor_required", "assignment_conflict"];

        // Each code once, in the order the rule writes them, whatever the order of the agents.
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, [withoutAirportId, busyWithoutTablet, junior]), false, 0,
            expected);
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, [junior, busyWithoutTablet, withoutAirportId]), false, 0,
            expected);
        // A code the order does not know yet goes last, once.
        var future = new OccAgentOptionData(Guid.NewGuid(), "Agente 4", "DEV-RA-004", false,
            ["future_rule", "shift_not_compatible", "future_rule"]);
        AssertVerdict(DemoStandEligibility.Evaluate(true, true, [future, junior]), false, 0,
            "shift_not_compatible", "mentor_required", "future_rule");
    }

    [Fact]
    public void TheReasonOrderIsTheOrderOfTheAssignmentRule()
    {
        Assert.Equal("stand_not_covered", DemoStandEligibility.ReasonOrder[0]);
        Assert.Equal(DemoStandEligibility.ReasonOrder.Count,
            DemoStandEligibility.ReasonOrder.Distinct(StringComparer.Ordinal).Count());
        // Everything that can fail at once, as OccAgentEligibilityPolicy writes it.
        var everything = Agent(1, candidate => candidate with
        {
            IsActive = false, HasMobileAccount = false, HasStationScope = false, HasTerminalScope = false,
            HasCurrentQualification = false, HasCurrentAirportId = false, HasCurrentRampDriverLicense = false,
            HasCompatibleShift = false, HasAssignmentConflict = true, HasApprovedAbsence = true, RequiresMentor = true,
        });
        Assert.Equal(
            DemoStandEligibility.ReasonOrder.Where(code => code is not ("stand_not_covered" or "operational_position_unavailable")),
            everything.EligibilityReasons);
        // The one that never comes with a qualification: a compatible shift without its operational position.
        var withoutPosition = Agent(2, candidate => candidate with
        {
            IsActive = false, HasTerminalScope = false, OperationalPositionId = null, HasCurrentAirportId = false,
        });
        Assert.Equal(
            ["agent_inactive", "terminal_scope_missing", "operational_position_unavailable", "airport_id_not_current"],
            withoutPosition.EligibilityReasons);
        Assert.Equal(withoutPosition.EligibilityReasons,
            DemoStandEligibility.ReasonOrder.Where(code => withoutPosition.EligibilityReasons.Contains(code)));
    }

    [Fact]
    public void TheWarningsSayNoLocatedStandsAndNoEligibleStandWithAtMostThreeReasons()
    {
        Assert.Equal(3, DemoStandEligibility.MaxWarningReasons);
        // No stand, or none the map knows: nothing to draw and no reason to give, as no stand is located and free.
        AssertWarnings(DemoStandEligibility.Warnings([]), ("no_located_stands", []), ("no_eligible_stand", []));
        AssertWarnings(DemoStandEligibility.Warnings([Option("B01", false, true, Agent(1)), Option("B02", false, true)]),
            ("no_located_stands", []), ("no_eligible_stand", []));

        // Located and free, but nobody eligible: what most of those stands share, at most three reasons, and the rule's
        // order when they share them equally («stand_not_covered» first).
        var offShift = OffShift(1);
        var junior = Agent(2, candidate => candidate with { RequiresMentor = true });
        var withoutAirportId = Agent(3, candidate => candidate with { HasCurrentAirportId = false });
        DemoStandOptionData[] stands =
        [
            Option("A1", true, true, offShift),
            Option("A2", true, true, offShift, junior),
            Option("A3", true, true, offShift, withoutAirportId),
            Option("A4", true, true),
            Option("A5", true, true),
            Option("A6", true, true, junior),
            // What a stand that is taken or unknown to the map would say never counts.
            new(Guid.NewGuid(), "A7", "A", true, false, [], 0, false, ["assignment_conflict", "approved_absence"]),
            new(Guid.NewGuid(), "A8", "A", false, true, [], 0, false, ["assignment_conflict", "approved_absence"]),
            new(Guid.NewGuid(), "A9", "A", false, false, [], 0, false, ["assignment_conflict", "approved_absence"]),
        ];
        AssertWarnings(DemoStandEligibility.Warnings(stands),
            ("no_eligible_stand", ["shift_not_compatible", "stand_not_covered", "mentor_required"]));
        AssertWarnings(DemoStandEligibility.Warnings([Option("A2", true, true, offShift), Option("A3", true, true, withoutAirportId)]),
            ("no_eligible_stand", ["airport_id_not_current", "shift_not_compatible"]));

        // One eligible stand is enough for the draw: no warning at all.
        Assert.Empty(DemoStandEligibility.Warnings([.. stands, Option("A10", true, true, Agent(4))]));
    }
}
