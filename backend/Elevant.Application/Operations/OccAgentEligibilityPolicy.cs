namespace Elevant.Application.Operations;

/// <summary>Evaluates the stable, first-version OCC agent eligibility rules.</summary>
public static class OccAgentEligibilityPolicy
{
    public static OccAgentOptionData Evaluate(OccAgentCandidateData candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);

        var reasons = new List<string>(8);
        if (!candidate.IsActive)
        {
            reasons.Add("agent_inactive");
        }

        if (!candidate.HasMobileAccount)
        {
            reasons.Add("mobile_account_unavailable");
        }

        if (!candidate.HasStationScope)
        {
            reasons.Add("station_scope_missing");
        }

        if (!candidate.HasTerminalScope)
        {
            reasons.Add("terminal_scope_missing");
        }

        if (!candidate.HasCurrentQualification)
        {
            reasons.Add("qualification_not_current");
        }

        if (!candidate.HasCurrentAirportId)
        {
            reasons.Add("airport_id_not_current");
        }

        if (!candidate.HasCurrentRampDriverLicense)
        {
            reasons.Add("ramp_driver_license_not_current");
        }

        if (!candidate.HasCompatibleShift)
        {
            reasons.Add("shift_not_compatible");
        }

        return new OccAgentOptionData(
            candidate.Id,
            candidate.DisplayName,
            candidate.EmployeeNumber,
            reasons.Count == 0,
            reasons);
    }
}
