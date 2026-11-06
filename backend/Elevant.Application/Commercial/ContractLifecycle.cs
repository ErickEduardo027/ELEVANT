using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>Whether a permit can be relied on today; computed, never stored (ADR-0024).</summary>
public enum PermitValidity { Current, Expiring, Expired }

/// <summary>Manual lifecycle actions Contratos can take on a contract.</summary>
public enum ContractLifecycleAction { Suspend, Reactivate, Terminate, Renew }

/// <summary>
/// Chronological rules of a contract (ADR-0024): it becomes active only when Finance approved the
/// version in force, both parties signed it and the airline holds a verified operating permit;
/// afterwards Contratos can suspend, reactivate, terminate or renew it, and the daily sweep
/// expires it after its last validity date.
/// </summary>
public static class ContractLifecycle
{
    /// <summary>Days before expiry when the permit and the contract are flagged and announced.</summary>
    public const int NoticeDays = 30;

    public static PermitValidity Validity(DateOnly expiresOn, DateOnly today) =>
        expiresOn < today ? PermitValidity.Expired
        : expiresOn <= today.AddDays(NoticeDays) ? PermitValidity.Expiring
        : PermitValidity.Current;

    /// <summary>An operating permit counts only once Contratos verified it and until it expires.</summary>
    public static bool IsUsable(AirlinePermitKind kind, AirlinePermitReview review, DateOnly expiresOn, DateOnly today) =>
        kind == AirlinePermitKind.OperatingPermit && review == AirlinePermitReview.Verified && expiresOn >= today;

    /// <summary>States a manual action may start from, and the state it leads to.</summary>
    public static ContractStatus? Target(ContractLifecycleAction action, ContractStatus current) => (action, current) switch
    {
        (ContractLifecycleAction.Suspend, ContractStatus.Active) => ContractStatus.Suspended,
        (ContractLifecycleAction.Reactivate, ContractStatus.Suspended) => ContractStatus.Active,
        (ContractLifecycleAction.Terminate, ContractStatus.Active or ContractStatus.Suspended or ContractStatus.Expired) =>
            ContractStatus.Terminated,
        // «Descartar contrato»: a contract that never activated is closed with its open versions (1-B).
        (ContractLifecycleAction.Terminate, ContractStatus.Draft) => ContractStatus.Terminated,
        // Renewal adds a draft version; the contract keeps its state until that version is approved and signed.
        (ContractLifecycleAction.Renew, ContractStatus.Active or ContractStatus.Suspended or ContractStatus.Expired) => current,
        _ => null,
    };

    public static bool ValidReason(string? reason) => reason?.Trim().Length is >= 5 and <= 500;
}
