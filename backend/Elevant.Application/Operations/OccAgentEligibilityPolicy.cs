namespace Elevant.Application.Operations;

/// <summary>
/// Evaluates OCC's agent eligibility: the same rules for the manual assignment, the stand reassignment and the
/// handover (3-D, 3-F, 3-N05).
/// </summary>
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

        if (candidate.HasCompatibleShift && candidate.OperationalPositionId is null)
        {
            reasons.Add("operational_position_unavailable");
        }

        if (candidate.OperationalPositionId is not null && !candidate.HasCurrentQualification)
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

        if (candidate.HasApprovedAbsence)
        {
            reasons.Add("approved_absence");
        }

        // Pillier: an agent with less than three months never works alone (ADR-0030); the coverage names the mentor.
        if (candidate.RequiresMentor)
        {
            reasons.Add("mentor_required");
        }

        // The agent already carries three simultaneous operations (3-D, OperationOccupancyRules).
        if (candidate.HasAssignmentConflict)
        {
            reasons.Add("assignment_conflict");
        }

        return new OccAgentOptionData(
            candidate.Id,
            candidate.DisplayName,
            candidate.EmployeeNumber,
            reasons.Count == 0,
            reasons);
    }
}
