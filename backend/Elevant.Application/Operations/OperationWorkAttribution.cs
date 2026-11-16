namespace Elevant.Application.Operations;

/// <summary>
/// Who worked a ground operation and for how long (3-N14), from its assignments of record and its actual start and
/// end. The reports (productivity per agent, the operations of the period) use this rule and nothing else decides it.
/// <list type="bullet">
/// <item>Before the start the operation belongs to its open assignments, with no minutes yet.</item>
/// <item>Once started, an assignment counts when it is still open or was released after the start and assigned before
/// the end: an agent released before the start (a stand change, a release from planning) never worked it.</item>
/// <item>Each agent's stretch runs from the later of the start and the assignment to the earlier of the release and
/// the end: in a handover (3-F) each agent gets the part they worked. An approval releases nobody (3-D), so an open
/// assignment keeps every minute up to the end.</item>
/// <item>Two agents assigned at once (a mentor and the agent under three months) both get the minutes they shared.</item>
/// <item>Without an actual end there are no minutes yet; an agent assigned twice is counted once over the union of
/// both stretches.</item>
/// </list>
/// </summary>
public static class OperationWorkAttribution
{
    /// <summary>One assignment of an agent to the operation, from when it was assigned to when it was released.</summary>
    public sealed record Assignment(long AgentId, DateTimeOffset AssignedAt, DateTimeOffset? ReleasedAt);

    /// <summary>An agent who worked (or, before the start, holds) the operation and the whole minutes of their stretch.</summary>
    public sealed record AgentWork(long AgentId, decimal Minutes);

    /// <summary>The agents the operation is attributed to, ordered by agent, each with the minutes they worked it.</summary>
    public static IReadOnlyList<AgentWork> Attribute(IEnumerable<Assignment> assignments, DateTimeOffset? actualStart,
        DateTimeOffset? actualEnd)
    {
        ArgumentNullException.ThrowIfNull(assignments);
        if (actualStart is not { } start)
            return assignments.Where(assignment => assignment.ReleasedAt is null).Select(assignment => assignment.AgentId)
                .Distinct().Order().Select(agent => new AgentWork(agent, 0m)).ToArray();

        var worked = assignments.Where(assignment => assignment.ReleasedAt is not { } released ||
            (released > start && (actualEnd is not { } finished || assignment.AssignedAt < finished)));
        return worked.GroupBy(assignment => assignment.AgentId).OrderBy(group => group.Key)
            .Select(group => new AgentWork(group.Key, actualEnd is { } end ? Minutes(group, start, end) : 0m))
            .ToArray();
    }

    /// <summary>The whole minutes of the union of an agent's stretches inside the operation's actual window.</summary>
    private static decimal Minutes(IEnumerable<Assignment> assignments, DateTimeOffset start, DateTimeOffset end)
    {
        var stretches = assignments
            .Select(assignment => (From: assignment.AssignedAt > start ? assignment.AssignedAt : start,
                To: assignment.ReleasedAt is { } released && released < end ? released : end))
            .Where(stretch => stretch.To > stretch.From).OrderBy(stretch => stretch.From).ToArray();
        var total = TimeSpan.Zero;
        DateTimeOffset? from = null, to = null;
        foreach (var stretch in stretches)
        {
            if (to is { } current && stretch.From <= current)
            {
                if (stretch.To > current) to = stretch.To;
                continue;
            }
            if (from is { } open && to is { } close) total += close - open;
            (from, to) = (stretch.From, stretch.To);
        }
        if (from is { } last && to is { } lastClose) total += lastClose - last;
        return Math.Round((decimal)total.TotalMinutes, 0);
    }
}
