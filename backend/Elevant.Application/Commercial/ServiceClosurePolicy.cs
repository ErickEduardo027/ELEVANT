namespace Elevant.Application.Commercial;

public static class ServiceClosurePolicy
{
    public static bool TryNormalizeReason(string? value, out string reason)
    {
        reason = value?.Trim() ?? string.Empty;
        return reason.Length is >= 10 and <= 1000;
    }

    public static bool CanDecide(Guid requesterAccountId, Guid decisionAccountId) =>
        requesterAccountId != Guid.Empty && decisionAccountId != Guid.Empty &&
        requesterAccountId != decisionAccountId;
}
