namespace Elevant.Application.Operations;

/// <summary>Evaluates local station shift coverage, including overnight shifts.</summary>
public static class OccShiftCoveragePolicy
{
    /// <summary>Requires a local shift (at most sixteen hours) to cover a whole operation.</summary>
    public static bool CoversInterval(
        DateOnly workDate,
        TimeOnly startsAt,
        TimeOnly endsAt,
        DateTime operationStartLocal,
        DateTime operationEndLocal)
    {
        if (startsAt == endsAt || operationEndLocal <= operationStartLocal)
            return false;

        var shiftStart = workDate.ToDateTime(startsAt);
        var shiftEnd = workDate.ToDateTime(endsAt);
        if (shiftEnd <= shiftStart)
            shiftEnd = shiftEnd.AddDays(1);

        return shiftEnd - shiftStart <= TimeSpan.FromHours(16) &&
            operationStartLocal >= shiftStart && operationEndLocal <= shiftEnd;
    }

    /// <summary>
    /// N24: whether a local shift lets its agent work an operation. With the operation's window
    /// (<see cref="WindowToCover"/>, in the station's local time) the shift must cover all of it
    /// (<see cref="CoversInterval"/>); without one, the instant the operation is judged at (<see cref="Covers"/>).
    /// </summary>
    public static bool CoversOperation(
        DateOnly workDate,
        TimeOnly startsAt,
        TimeOnly endsAt,
        DateTime referenceLocal,
        (DateTime Start, DateTime End)? windowLocal) =>
        windowLocal is { } window
            ? CoversInterval(workDate, startsAt, endsAt, window.Start, window.End)
            : Covers(workDate, startsAt, endsAt, DateOnly.FromDateTime(referenceLocal),
                TimeOnly.FromDateTime(referenceLocal));

    /// <summary>
    /// N24 (D-N24): the part of an operation's planned window an agent's shift must cover. It is the whole stay; an
    /// assignment made after the planned start needs only what is left of it, from <paramref name="now"/>; once the
    /// planned end has passed it is the whole stay again, as planned. Null without a window: a missing bound, or an end
    /// at or before the start.
    /// </summary>
    public static (DateTimeOffset Start, DateTimeOffset End)? WindowToCover(
        DateTimeOffset? plannedStartAt,
        DateTimeOffset? plannedEndAt,
        DateTimeOffset now)
    {
        if (plannedStartAt is not { } start || plannedEndAt is not { } end || end <= start)
            return null;

        return now > start && now < end ? (now, end) : (start, end);
    }

    public static bool Covers(
        DateOnly workDate,
        TimeOnly startsAt,
        TimeOnly endsAt,
        DateOnly localDate,
        TimeOnly localTime)
    {
        if (startsAt == endsAt)
        {
            return false;
        }

        if (startsAt < endsAt)
        {
            return workDate == localDate && localTime >= startsAt && localTime < endsAt;
        }

        return (workDate == localDate && localTime >= startsAt) ||
            (workDate == localDate.AddDays(-1) && localTime < endsAt);
    }
}
