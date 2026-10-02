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
