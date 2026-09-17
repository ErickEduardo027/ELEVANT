namespace Elevant.Application.Operations;

/// <summary>Evaluates local station shift coverage, including overnight shifts.</summary>
public static class OccShiftCoveragePolicy
{
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
