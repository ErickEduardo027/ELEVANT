using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0045: a stand that requires a permit admits only an agent with a current cycle of it, in the coverage and in the
/// assignment, and the refusal names the permit («Le falta: …»). The store passes only the codes current for the work
/// date or window, so an expired cycle is simply a code the agent does not hold.
/// </summary>
public sealed class RequiredPermitPolicyTests
{
    private static readonly RequiredPermitFact Restricted = new("ZONA-RESTRINGIDA", "Carnet de zona restringida");
    private static readonly DateOnly WorkDate = new(2026, 11, 16);
    private static readonly DateTimeOffset Start = new(2026, 11, 16, 10, 0, 0, TimeSpan.Zero);

    private static PositionCoverageCandidate Coverage(IReadOnlyCollection<string>? held,
        params RequiredPermitFact[] required) => new(
        Start, Start.AddHours(8), WorkDate, new CoverageTerminalRules(3, false),
        [new CoverageStandFacts(Guid.NewGuid(), "A5", true, true, false, required),
            new CoverageStandFacts(Guid.NewGuid(), "A6", true, true, false)],
        new CoverageAgentFacts(true, new DateOnly(2025, 1, 1), true, false, false, true, false, false, true, held),
        null, null, false, []);

    private static OccAgentCandidateData Candidate(IReadOnlyCollection<string>? held,
        params RequiredPermitFact[] required) => new(
        Guid.Parse("51000000-0000-7000-8000-000000000001"), "Riley Ramp", "DEV-RA-001", IsActive: true,
        HasMobileAccount: true, HasStationScope: true, HasTerminalScope: true, HasCurrentQualification: true,
        HasCurrentAirportId: true, HasCurrentRampDriverLicense: true, HasCompatibleShift: true,
        OperationalPositionId: Guid.Parse("52000000-0000-7000-8000-000000000001"), HasAssignmentConflict: false,
        CurrentPermitCodes: held, RequiredPermits: required);

    [Fact]
    public void ACoverageOfAStandThatRequiresAPermitTheAgentLacksIsRefusedWithItsName()
    {
        var candidate = Coverage([], Restricted);
        Assert.Equal(["required_permit_missing"], PositionCoveragePolicy.Evaluate(candidate));
        Assert.Equal([Restricted], PositionCoveragePolicy.MissingPermits(candidate));
    }

    [Fact]
    public void ACurrentCycleOfTheRequiredPermitAdmitsTheCoverage()
    {
        var candidate = Coverage(["ZONA-RESTRINGIDA"], Restricted);
        Assert.Empty(PositionCoveragePolicy.Evaluate(candidate));
        Assert.Empty(PositionCoveragePolicy.MissingPermits(candidate));
    }

    [Fact]
    public void AnExpiredCycleIsNotCurrentSoTheStandStillRefusesIt()
    {
        // The store never passes an expired code; another current permit does not stand in for it.
        var candidate = Coverage(["AirportId", "OTRO-CARNET"], Restricted);
        Assert.Contains("required_permit_missing", PositionCoveragePolicy.Evaluate(candidate));
    }

    [Fact]
    public void StandsWithoutRequirementsKeepTheRulesOfToday()
    {
        Assert.Empty(PositionCoveragePolicy.Evaluate(Coverage(null)));
        Assert.True(OccAgentEligibilityPolicy.Evaluate(Candidate(null)).Eligible);
    }

    [Fact]
    public void TheAssignmentOfAFlightOnTheStandNamesTheMissingPermit()
    {
        var refused = OccAgentEligibilityPolicy.Evaluate(Candidate([], Restricted));
        Assert.False(refused.Eligible);
        Assert.Equal(["required_permit_missing"], refused.EligibilityReasons);
        Assert.Equal(["Carnet de zona restringida"], refused.MissingPermits);

        var admitted = OccAgentEligibilityPolicy.Evaluate(Candidate(["ZONA-RESTRINGIDA"], Restricted));
        Assert.True(admitted.Eligible);
        Assert.Null(admitted.MissingPermits);
    }

    [Fact]
    public void ARequiredSystemPermitIsCheckedByTheSameRuleAndEachPermitIsNamedOnce()
    {
        var license = new RequiredPermitFact("RampDriverLicense", "Licencia de conducir en rampa");
        var missing = RequiredPermitRules.Missing([Restricted, license, Restricted], ["RampDriverLicense"]);
        Assert.Equal([Restricted], missing);
    }
}
