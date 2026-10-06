using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Identity;

public static class HumanResourcesReportPolicy
{
    public static bool ValidRange(DateOnly from, DateOnly to) =>
        from != default && to >= from && to.DayNumber - from.DayNumber < 30;

    public static bool ValidExpirationFilters(HumanResourcesReportKind kind,
        string? documentKind, string? validity) =>
        (kind == HumanResourcesReportKind.Expirations ||
            (documentKind is null && validity is null)) &&
        documentKind is null or "Qualification" or "Permit" &&
        validity is null or "Current" or "Expired";
}
