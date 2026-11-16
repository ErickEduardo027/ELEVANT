using Elevant.Application.Integration.DemoFlights;

namespace Elevant.Application.Operations.DemoStation;

/// <summary>
/// Which stands a demo flight can be sent to (ADR-0041, owner decision 22, contracts 1.1): a stand is eligible when the
/// map knows where it is, it is free during the visit and an agent who covers it at the on-block instant passes the
/// real assignment rule (<see cref="OccAgentEligibilityPolicy"/>). Only eligible stands enter the random draw, and a
/// stand chosen by hand must be eligible too.
/// </summary>
public static class DemoStandEligibility
{
    /// <summary>The most reasons the warning <c>no_eligible_stand</c> names.</summary>
    public const int MaxWarningReasons = 3;

    /// <summary>
    /// The order the reasons are given in: first that nobody covers the stand, then the codes of
    /// <see cref="OccAgentEligibilityPolicy"/> in the order the policy writes them. A code the list does not know yet
    /// goes last.
    /// </summary>
    public static IReadOnlyList<string> ReasonOrder { get; } =
    [
        DemoFlightCodes.StandNotCovered,
        "agent_inactive",
        "mobile_account_unavailable",
        "station_scope_missing",
        "terminal_scope_missing",
        "operational_position_unavailable",
        "qualification_not_current",
        "airport_id_not_current",
        "ramp_driver_license_not_current",
        "shift_not_compatible",
        "approved_absence",
        "mentor_required",
        "assignment_conflict",
    ];

    private static readonly Dictionary<string, int> Ranks = ReasonOrder.Select((reason, index) => (reason, index))
        .ToDictionary(item => item.reason, item => item.index, StringComparer.Ordinal);

    /// <summary>
    /// Whether a stand is eligible, given whether it is located and free and the agents who cover it at the on-block
    /// instant, evaluated with the assignment rule. <c>EligibleAgents</c> counts the covering agents who pass it.
    /// <c>Reasons</c> explains a located and free stand that is not eligible: <c>stand_not_covered</c> when nobody covers
    /// it, otherwise the rule's codes of the agents who do, each once and in <see cref="ReasonOrder"/>. It is empty for an
    /// eligible stand and for one that is not located or not free, which its flags already explain.
    /// </summary>
    public static (bool Eligible, int EligibleAgents, IReadOnlyList<string> Reasons) Evaluate(bool located, bool free,
        IReadOnlyList<OccAgentOptionData> covering)
    {
        ArgumentNullException.ThrowIfNull(covering);
        var eligibleAgents = covering.Count(agent => agent.Eligible);
        if (!located || !free || eligibleAgents > 0) return (located && free && eligibleAgents > 0, eligibleAgents, []);
        if (covering.Count == 0) return (false, 0, [DemoFlightCodes.StandNotCovered]);
        return (false, 0, covering.SelectMany(agent => agent.EligibilityReasons).Distinct(StringComparer.Ordinal)
            .OrderBy(Rank).ToArray());
    }

    /// <summary>
    /// The warnings of the options about the stands, which never block the trigger: <c>no_located_stands</c> when the map
    /// knows where none of them is, and <c>no_eligible_stand</c> when none is eligible (so «Al azar» cannot draw one),
    /// with at most <see cref="MaxWarningReasons"/> reasons: the ones the most located and free stands give, in
    /// <see cref="ReasonOrder"/> when two are given equally often.
    /// </summary>
    public static IReadOnlyList<DemoFlightWarningData> Warnings(IReadOnlyList<DemoStandOptionData> stands)
    {
        ArgumentNullException.ThrowIfNull(stands);
        var warnings = new List<DemoFlightWarningData>(2);
        if (!stands.Any(stand => stand.Located))
            warnings.Add(new DemoFlightWarningData(DemoFlightCodes.NoLocatedStands, []));
        if (!stands.Any(stand => stand.Eligible))
            warnings.Add(new DemoFlightWarningData(DemoFlightCodes.NoEligibleStand, stands
                .Where(stand => stand.Located && stand.Free)
                .SelectMany(stand => stand.Reasons.Distinct(StringComparer.Ordinal))
                .GroupBy(reason => reason, StringComparer.Ordinal)
                .OrderByDescending(group => group.Count()).ThenBy(group => Rank(group.Key))
                .ThenBy(group => group.Key, StringComparer.Ordinal)
                .Take(MaxWarningReasons).Select(group => group.Key).ToArray()));
        return warnings;
    }

    private static int Rank(string reason) => Ranks.GetValueOrDefault(reason, int.MaxValue);
}
