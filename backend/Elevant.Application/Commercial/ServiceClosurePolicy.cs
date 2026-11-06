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

    /// <summary>
    /// Why OCC cannot report a closure of the service, or null when it can: only a published service is
    /// reported, and once per pending request.
    /// </summary>
    public static string? RequestIssue(bool serviceActive, bool servicePublic, bool hasPendingClosure) =>
        !serviceActive || !servicePublic ? CommercialCatalogIssues.ServiceNotPublished
        : hasPendingClosure ? CommercialCatalogIssues.ClosurePending
        : null;

    /// <summary>
    /// Why Contratos cannot republish the service from its approved closure, or null when it can (1-N11).
    /// A retired service is reactivated in the catalog first; a pending request is decided first.
    /// </summary>
    public static string? ReopenIssue(bool serviceActive, bool servicePublic, bool hasPendingClosure,
        bool hasApprovedClosure) =>
        !serviceActive ? CommercialCatalogIssues.ServiceRetired
        : servicePublic ? CommercialCatalogIssues.ServiceAlreadyPublic
        : hasPendingClosure ? CommercialCatalogIssues.ClosurePending
        : !hasApprovedClosure ? CommercialCatalogIssues.NoApprovedClosure
        : null;
}
