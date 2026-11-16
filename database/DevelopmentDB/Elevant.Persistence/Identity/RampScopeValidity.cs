using Elevant.Application.Common;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Ramp scope dates are AVIAM's business days (2-N31): the profile editor, the employee records and the access
/// validation write them with <see cref="BusinessCalendar"/>. Audit attribution evaluates them the same way.
/// </summary>
internal static class RampScopeValidity
{
    public static bool IsCurrent(DateOnly validFrom, DateOnly? validTo,
        DateTimeOffset at)
    {
        var date = BusinessCalendar.Today(at);
        return validFrom <= date && (validTo is null || validTo >= date);
    }
}
