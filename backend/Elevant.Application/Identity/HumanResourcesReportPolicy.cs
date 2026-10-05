namespace Elevant.Application.Identity;

public static class HumanResourcesReportPolicy
{
    public static bool ValidRange(DateOnly from, DateOnly to) =>
        from != default && to >= from && to.DayNumber - from.DayNumber < 30;
}
