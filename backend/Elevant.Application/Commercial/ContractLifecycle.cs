using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>Whether a permit can be relied on today; computed, never stored (ADR-0024).</summary>
public enum PermitValidity { Current, Expiring, Expired }

/// <summary>
/// Manual lifecycle actions Contratos can take on a contract. <see cref="CancelTermination"/> withdraws
/// a termination scheduled for a later date (2-N14).
/// </summary>
public enum ContractLifecycleAction { Suspend, Reactivate, Terminate, Renew, CancelTermination }

/// <summary>Stable codes of the contract lifecycle and of the versions that govern it (phase 2, block A).</summary>
public static class ContractLifecycleIssues
{
    public const string ContractTerminated = "contract_terminated";
    public const string TerminationScheduled = "termination_scheduled";
    public const string TerminationNotScheduled = "termination_not_scheduled";
    public const string TerminationDateRequired = "termination_date_required";
    public const string TerminationNoticeNotMet = "termination_notice_not_met";
    public const string ImmediateCauseInvalid = "immediate_cause_invalid";
    public const string VersionAwaitingSignatures = "version_awaiting_signatures";
    public const string VersionSigned = "version_signed";
    public const string NotApproved = "not_approved";
    public const string ContentChanged = "content_changed";
    public const string AirlineSignedOtherContent = "airline_signed_other_content";
    public const string RenewalBlocked = "contract_renewal_blocked";
}

/// <summary>
/// Why a contract was suspended, as the airline's email tells it (2-N12): by hand (never with the internal
/// reason of Contratos), because its operating permit expired, or because Contratos revoked the
/// verification of that permit (2-N09).
/// </summary>
public enum ContractSuspensionCause { Manual, PermitExpired, PermitRevoked }

/// <summary>Stable codes of the airline permit dossier and its commands (phase 2, block B).</summary>
public static class AirlinePermitIssues
{
    /// <summary>The permit was already verified, rejected or revoked: only a submitted one is reviewed.</summary>
    public const string ReviewClosed = "review_closed";
    /// <summary>Only a verified permit can be revoked.</summary>
    public const string NotVerified = "permit_not_verified";
    public const string NoteRequired = "review_note_required";
    public const string Invalid = "invalid_permit";
    public const string DatesInvalid = "permit_dates_invalid";
    public const string Expired = "permit_expired";
    public const string DocumentInvalid = "document_invalid";
    /// <summary>The scan was uploaded before the media link window: it may be cleaned up, upload it again (2-N37).</summary>
    public const string DocumentExpired = "document_expired";
}

/// <summary>Spanish names of the permits of the dossier, for the history and the airline's emails.</summary>
public static class AirlinePermitNames
{
    public static string Of(AirlinePermitKind kind) => kind switch
    {
        AirlinePermitKind.OperatingPermit => "permiso de operación",
        AirlinePermitKind.AirOperatorCertificate => "certificado de explotador",
        AirlinePermitKind.Insurance => "póliza de seguro",
        _ => "documento",
    };
}

/// <summary>Explicit causes that end an active or suspended contract at once, without the signed notice (2-N14).</summary>
public static class ContractTerminationCauses
{
    public const string Breach = "Breach";
    public const string MutualAgreement = "MutualAgreement";

    public static bool IsValid(string? cause) => cause is Breach or MutualAgreement;

    /// <summary>How the history names the cause, before the note Contratos wrote.</summary>
    public static string Label(string cause) => cause == Breach ? "Incumplimiento" : "Mutuo acuerdo";
}

/// <summary>
/// How a termination ends the contract: <see cref="TerminatedOn"/> is the first day without coverage;
/// when it is in the future the contract keeps its status until the sweep terminates it.
/// </summary>
public readonly record struct ContractTerminationPlan(DateOnly TerminatedOn, bool Immediate);

/// <summary>
/// Chronological rules of a contract (ADR-0024): it becomes active only when Finance approved the
/// version in force, both parties signed it and the airline holds a verified operating permit;
/// afterwards Contratos can suspend, reactivate, terminate (now or after the signed notice) or renew
/// it, and the daily sweep expires it after its last validity date.
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

    /// <summary>
    /// Days before its end a contract is announced as expiring (2-N12): the RenewalNoticeDays its version
    /// signed («AVIAM avisa con N días de antelación»), or <see cref="NoticeDays"/> for a version without
    /// validity terms.
    /// </summary>
    public static int ExpiryNoticeDays(int? renewalNoticeDays) =>
        renewalNoticeDays is { } days && days >= 0 ? days : NoticeDays;

    /// <summary>
    /// Whether the expiry notice of a contract whose coverage ends on <paramref name="lastDay"/> is due today:
    /// the end is not past and falls within the notice days.
    /// </summary>
    public static bool ExpiryNoticeDue(DateOnly lastDay, int noticeDays, DateOnly today) =>
        lastDay >= today && lastDay <= today.AddDays(Math.Max(0, noticeDays));


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
        // Cancelling a scheduled termination keeps the contract as it is (2-N14); one that expired while the
        // termination waited can then be renewed.
        (ContractLifecycleAction.CancelTermination,
            ContractStatus.Active or ContractStatus.Suspended or ContractStatus.Expired) => current,
        _ => null,
    };

    public static bool ValidReason(string? reason) => reason?.Trim().Length is >= 5 and <= 500;

    /// <summary>
    /// When a termination takes effect (2-N14). A draft («Descartar contrato») or an expired contract
    /// ends at once. An active or suspended one needs an effective date no earlier than today plus the
    /// notice days of the version in force, or an explicit immediate cause (breach or mutual agreement)
    /// whose note is the reason. An immediate cause also ends a contract whose termination was scheduled;
    /// another date needs that termination cancelled first.
    /// </summary>
    public static (ContractTerminationPlan? Plan, string? Issue) PlanTermination(ContractStatus status, DateOnly today,
        DateOnly? effectiveOn, string? immediateCause, int noticeDays, DateOnly? scheduledOn)
    {
        if (status is ContractStatus.Draft or ContractStatus.Expired) return (new(today, true), null);
        if (!string.IsNullOrWhiteSpace(immediateCause))
            return ContractTerminationCauses.IsValid(immediateCause)
                ? (new(today, true), null) : (null, ContractLifecycleIssues.ImmediateCauseInvalid);
        if (scheduledOn is not null) return (null, ContractLifecycleIssues.TerminationScheduled);
        if (effectiveOn is not { } date) return (null, ContractLifecycleIssues.TerminationDateRequired);
        if (date < today.AddDays(Math.Max(0, noticeDays))) return (null, ContractLifecycleIssues.TerminationNoticeNotMet);
        return (new(date, date <= today), null);
    }

    /// <summary>
    /// Why a version starting on <paramref name="versionStart"/> cannot move forward on its contract:
    /// the contract is terminated, or its scheduled termination falls on or before that start.
    /// </summary>
    public static string? ClosedFor(ContractStatus status, DateOnly? terminatedOn, DateOnly versionStart) =>
        status == ContractStatus.Terminated ? ContractLifecycleIssues.ContractTerminated
        : terminatedOn is { } end && versionStart >= end ? ContractLifecycleIssues.TerminationScheduled
        : null;
}
