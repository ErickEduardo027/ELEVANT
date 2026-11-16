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
            HasAssignmentConflict = true,
            HasApprovedAbsence = true,
            RequiresMentor = true,
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
                "approved_absence",
                "mentor_required",
                "assignment_conflict",
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
            { "operational_position_unavailable", candidate => candidate with { OperationalPositionId = null } },
            { "qualification_not_current", candidate => candidate with { HasCurrentQualification = false } },
            { "airport_id_not_current", candidate => candidate with { HasCurrentAirportId = false } },
            { "ramp_driver_license_not_current", candidate => candidate with { HasCurrentRampDriverLicense = false } },
            {
                "shift_not_compatible",
                candidate => candidate with
                {
                    HasCompatibleShift = false,
                    OperationalPositionId = null,
                }
            },
            { "assignment_conflict", candidate => candidate with { HasAssignmentConflict = true } },
            { "approved_absence", candidate => candidate with { HasApprovedAbsence = true } },
            // 3-D: an agent with less than three months and no coverage with a mentor never works alone.
            { "mentor_required", candidate => candidate with { RequiresMentor = true } },
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
        HasCompatibleShift: true,
        OperationalPositionId: Guid.Parse("52000000-0000-7000-8000-000000000001"),
        HasAssignmentConflict: false);
}
