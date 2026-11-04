namespace Elevant.Application.Operations;

/// <summary>Rules of the terminal where the coverage is (ADR-0030).</summary>
/// <param name="MaxStandsPerAgent">Most stands one agent covers here; 3 when the terminal does not say.</param>
public sealed record CoverageTerminalRules(int MaxStandsPerAgent, bool RequiresBridgeQualification);

/// <summary>One requested stand as the store found it.</summary>
public sealed record CoverageStandFacts(Guid StandId, string Code, bool IsActive, bool InTerminal, bool HasBoardingBridge);

/// <summary>Another active coverage that overlaps the requested window on one of the requested stands.</summary>
/// <param name="IsMentorPair">It belongs to the mentor of this agent, or this agent mentors it.</param>
public sealed record CoverageStandOverlap(Guid StandId, string StandCode, bool IsMentorPair);

/// <summary>What the store knows about the agent for the requested window.</summary>
public sealed record CoverageAgentFacts(
    bool IsActive,
    DateOnly HireDate,
    bool HasAirportPermit,
    bool HasDriverLicense,
    bool HasBridgeQualification,
    bool ShiftCoversWindow,
    bool HasApprovedAbsence,
    bool HasOverlappingCoverage);

/// <summary>The mentor, when one is named.</summary>
public sealed record CoverageMentorFacts(bool IsActive, DateOnly HireDate, bool ShiftCoversWindow);

public sealed record PositionCoverageCandidate(
    DateTimeOffset StartsAt,
    DateTimeOffset EndsAt,
    DateOnly WorkDate,
    CoverageTerminalRules Terminal,
    IReadOnlyList<CoverageStandFacts> Stands,
    CoverageAgentFacts Agent,
    CoverageMentorFacts? Mentor,
    string? VehicleCode,
    bool IsReinforcement,
    IReadOnlyList<CoverageStandOverlap> Overlaps);

/// <summary>
/// Pillier's assignment rules for covering stands during a shift (ADR-0030). Pure: the store
/// gathers the facts inside its transaction and this decides. Returns the broken rules, in a stable
/// order, as codes the clients translate; an empty list means the coverage can be saved.
/// </summary>
public static class PositionCoveragePolicy
{
    public const int DefaultMaxStandsPerAgent = 3;

    /// <summary>More stands than this need a driving licence and a vehicle.</summary>
    public const int StandsWithoutVehicle = 2;

    /// <summary>Agents with less seniority than this never cover alone.</summary>
    public const int MonthsBeforeWorkingAlone = 3;

    public static readonly TimeSpan MaxWindow = TimeSpan.FromHours(16);

    public static IReadOnlyList<string> Evaluate(PositionCoverageCandidate candidate)
    {
        ArgumentNullException.ThrowIfNull(candidate);
        var reasons = new List<string>();
        void Add(string reason)
        {
            if (!reasons.Contains(reason, StringComparer.Ordinal)) reasons.Add(reason);
        }

        if (candidate.EndsAt <= candidate.StartsAt || candidate.EndsAt - candidate.StartsAt > MaxWindow)
            Add("window_invalid");
        if (candidate.Stands.Count == 0) Add("no_stands");
        if (candidate.Stands.Any(stand => !stand.IsActive)) Add("stand_inactive");
        if (candidate.Stands.Any(stand => !stand.InTerminal)) Add("stand_other_terminal");
        if (candidate.Stands.Count > candidate.Terminal.MaxStandsPerAgent) Add("too_many_stands");
        if (candidate.Stands.Count > StandsWithoutVehicle)
        {
            if (!candidate.Agent.HasDriverLicense) Add("driver_license_required");
            if (string.IsNullOrWhiteSpace(candidate.VehicleCode)) Add("vehicle_required");
        }

        var agent = candidate.Agent;
        if (!agent.IsActive) Add("agent_inactive");
        if (!agent.HasAirportPermit) Add("airport_permit_required");
        var needsBridge = candidate.Terminal.RequiresBridgeQualification ||
                          candidate.Stands.Any(stand => stand.HasBoardingBridge);
        if (needsBridge && !agent.HasBridgeQualification) Add("bridge_qualification_required");
        if (!agent.ShiftCoversWindow) Add("shift_not_covering");
        if (agent.HasApprovedAbsence) Add("absent");
        if (agent.HasOverlappingCoverage) Add("agent_overlap");

        var junior = IsJunior(agent.HireDate, candidate.WorkDate);
        if (candidate.Mentor is null)
        {
            if (junior) Add("mentor_required");
        }
        else if (!candidate.Mentor.IsActive || IsJunior(candidate.Mentor.HireDate, candidate.WorkDate) ||
                 !candidate.Mentor.ShiftCoversWindow)
        {
            Add("mentor_not_eligible");
        }

        // A stand already covered by someone else is only shared by a trainee with their mentor,
        // or when OCC marks this coverage as a reinforcement (peak hours).
        if (!candidate.IsReinforcement && candidate.Overlaps.Any(overlap => !overlap.IsMentorPair))
            Add("stand_taken");
        return reasons;
    }

    /// <summary>Less than three months since hiring on the work date.</summary>
    public static bool IsJunior(DateOnly hireDate, DateOnly workDate) =>
        hireDate.AddMonths(MonthsBeforeWorkingAlone) > workDate;
}
