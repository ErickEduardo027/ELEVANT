namespace Elevant.Persistence.Identity;

/// <summary>
/// Ramp profile scope dates are written as UTC calendar dates by the profile
/// editor. Audit attribution must evaluate them using that same convention.
/// </summary>
internal static class RampScopeValidity
{
    public static bool IsCurrent(DateOnly validFrom, DateOnly? validTo,
        DateTimeOffset at)
    {
        var date = DateOnly.FromDateTime(at.UtcDateTime);
        return validFrom <= date && (validTo is null || validTo >= date);
    }
}
