using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>
/// Stable Problem Details codes of the catalog and service-closure commands (phase 1, block D). The
/// clients explain the code, never the title.
/// </summary>
public static class CommercialCatalogIssues
{
    /// <summary>A contract in force, or one Finance is approving, still uses the service (1-N03).</summary>
    public const string ServiceInActiveContract = "service_in_active_contract";

    /// <summary>The edit form only hides a service; «Dar de baja» is its own command (1-N03).</summary>
    public const string RetirementCommandRequired = "retirement_command_required";

    /// <summary>An approved closure keeps the service hidden until Contratos republishes it (1-N11).</summary>
    public const string ClosureRequiresReopen = "closure_requires_reopen";

    /// <summary>The service was retired from the catalog: the same meaning as in the contract drafts.</summary>
    public const string ServiceRetired = ContractDraftIssues.ServiceRetired;

    /// <summary>Another service already has the code.</summary>
    public const string ServiceCodeExists = "service_code_exists";

    /// <summary>Default code of invalid service data.</summary>
    public const string InvalidService = "invalid_service";

    /// <summary>The photo or video is not an uploaded catalog asset that can still be linked.</summary>
    public const string MediaInvalid = "media_invalid";

    /// <summary>The service a closure request names does not exist.</summary>
    public const string ServiceNotFound = "service_not_found";

    /// <summary>Default code of invalid closure data.</summary>
    public const string InvalidClosure = "invalid_closure";

    /// <summary>The service already has a closure request waiting for Contratos.</summary>
    public const string ClosurePending = "closure_pending";

    /// <summary>The closure request was already decided.</summary>
    public const string ClosureNotPending = "closure_not_pending";

    /// <summary>Four eyes: whoever reported the closure cannot decide it.</summary>
    public const string ClosureSelfDecision = "closure_self_decision";

    /// <summary>OCC reports closures of published services only.</summary>
    public const string ServiceNotPublished = "service_not_published";

    /// <summary>The service is already in the public catalog.</summary>
    public const string ServiceAlreadyPublic = "service_already_public";

    /// <summary>No approved closure keeps the service hidden, so there is nothing to reopen.</summary>
    public const string NoApprovedClosure = "no_approved_closure";
}

/// <summary>
/// «Ocultar del catálogo público» and «Dar de baja» are different decisions (1-N03). Hiding only stops new
/// airlines from asking for the service; retiring also stops new contracts and the operation from using
/// it, so it has its own command with a reason and is refused while a contract keeps the service in force.
/// </summary>
public static class CommercialServiceRetirement
{
    /// <summary>
    /// Whether a contract version keeps its services in force: a version Finance is approving, or an
    /// approved or superseded version that has not ended, of a contract that is not closed. A draft
    /// contract counts once Finance approved its version, because signing activates it. Draft versions
    /// do not count: a retired service stays marked in them and blocks the submission (1-N10). One day of
    /// margin covers the stations whose local date is behind UTC.
    /// </summary>
    public static bool KeepsServiceInForce(ContractStatus contract, ContractVersionStatus version,
        DateOnly? validTo, DateOnly today) =>
        (contract is ContractStatus.Draft or ContractStatus.Active or ContractStatus.Suspended) &&
        (version == ContractVersionStatus.PendingFinanceApproval ||
         (version is ContractVersionStatus.Approved or ContractVersionStatus.Superseded &&
          (validTo is null || validTo >= today.AddDays(-1))));

    /// <summary>
    /// Why the edit form cannot save the requested flags, or null when it can. It never retires an active
    /// service, a retired service cannot be published until it is reactivated, and a service hidden by an
    /// approved closure (<paramref name="hiddenByClosure"/>) is republished from the closure, with a reason.
    /// </summary>
    public static string? UpdateIssue(bool isActive, bool isPublic, bool requestedActive, bool requestedPublic,
        bool hiddenByClosure) =>
        isActive && !requestedActive ? CommercialCatalogIssues.RetirementCommandRequired
        : !requestedActive && requestedPublic ? CommercialCatalogIssues.ServiceRetired
        : !isPublic && requestedPublic && hiddenByClosure ? CommercialCatalogIssues.ClosureRequiresReopen
        : null;

    /// <summary>The reason of a retirement: the same 10 to 1000 characters as a closure decision.</summary>
    public static bool TryNormalizeReason(string? value, out string reason) =>
        ServiceClosurePolicy.TryNormalizeReason(value, out reason);
}
