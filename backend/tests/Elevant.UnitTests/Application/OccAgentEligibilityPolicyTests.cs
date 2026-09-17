using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

public sealed class OccAgentEligibilityPolicyTests
{
    [Fact]
    public void FullyEligibleAgentHasNoReasons()
    {
        var result = OccAgentEligibilityPolicy.Evaluate(CreateCandidate());

        Assert.True(result.Eligible);
        Assert.Empty(result.EligibilityReasons);
    }

    [Fact]
    public void IneligibleAgentReturnsEveryReasonInStableOrder()
    {
        var result = OccAgentEligibilityPolicy.Evaluate(CreateCandidate() with
        {
            IsActive = false,
            HasMobileAccount = false,
            HasStationScope = false,
            HasTerminalScope = false,
            HasCurrentQualification = false,
            HasCurrentAirportId = false,
            HasCurrentRampDriverLicense = false,
            HasCompatibleShift = false,
        });

        Assert.False(result.Eligible);
        Assert.Equal(
            [
                "agent_inactive",
                "mobile_account_unavailable",
                "station_scope_missing",
                "terminal_scope_missing",
                "qualification_not_current",
                "airport_id_not_current",
                "ramp_driver_license_not_current",
                "shift_not_compatible",
            ],
            result.EligibilityReasons);
    }

    public static TheoryData<string, Func<OccAgentCandidateData, OccAgentCandidateData>> SingleFailures =>
        new()
        {
            { "agent_inactive", candidate => candidate with { IsActive = false } },
            { "mobile_account_unavailable", candidate => candidate with { HasMobileAccount = false } },
            { "station_scope_missing", candidate => candidate with { HasStationScope = false } },
            { "terminal_scope_missing", candidate => candidate with { HasTerminalScope = false } },
            { "qualification_not_current", candidate => candidate with { HasCurrentQualification = false } },
            { "airport_id_not_current", candidate => candidate with { HasCurrentAirportId = false } },
            { "ramp_driver_license_not_current", candidate => candidate with { HasCurrentRampDriverLicense = false } },
            { "shift_not_compatible", candidate => candidate with { HasCompatibleShift = false } },
        };

    [Theory]
    [MemberData(nameof(SingleFailures))]
    public void EachEligibilityFactHasItsOwnStableReason(
        string expectedReason,
        Func<OccAgentCandidateData, OccAgentCandidateData> mutate)
    {
        var result = OccAgentEligibilityPolicy.Evaluate(mutate(CreateCandidate()));

        Assert.False(result.Eligible);
        Assert.Equal([expectedReason], result.EligibilityReasons);
    }

    private static OccAgentCandidateData CreateCandidate() => new(
        Guid.Parse("51000000-0000-7000-8000-000000000001"),
        "Riley Ramp",
        "DEV-RA-001",
        IsActive: true,
        HasMobileAccount: true,
        HasStationScope: true,
        HasTerminalScope: true,
        HasCurrentQualification: true,
        HasCurrentAirportId: true,
        HasCurrentRampDriverLicense: true,
        HasCompatibleShift: true);
}
