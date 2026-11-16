using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>Stable codes of why Contratos cannot start an amendment (phase 1, 1-C).</summary>
public static class ContractAmendmentIssues
{
    public const string InvalidAmendment = "invalid_amendment";
    public const string ContractNotAmendable = "contract_not_amendable";
    public const string DraftInProgress = "draft_in_progress";
    public const string NoApprovedVersion = "no_approved_version";
    public const string ValidFromAfterCurrentEnd = "valid_from_after_current_end";
}

/// <summary>
/// Rules of a contract amendment (1-C): it always starts from the latest approved version, inherits
/// its end and only asks «Vigente desde», which must fall after the start of that version and not
/// after its end. The rates are copied unconfirmed, so Contratos reviews them before Finance.
/// </summary>
public static class ContractAmendment
{
    /// <summary>A contract in force, or suspended while its permit is renewed, can be amended.</summary>
    public static bool CanAmend(ContractStatus status) => status is ContractStatus.Active or ContractStatus.Suspended;

    /// <summary>
    /// Why <paramref name="validFrom"/> cannot start an amendment of the version that runs from
    /// <paramref name="currentFrom"/> to <paramref name="currentTo"/>; null when it can. The start rule
    /// is the one the draft save, the submission and the Finance approval apply.
    /// </summary>
    public static string? StartIssue(DateOnly validFrom, DateOnly currentFrom, DateOnly? currentTo) =>
        !ContractDraftRules.StartsAfterCurrent(validFrom, currentFrom) ? ContractDraftIssues.ValidFromNotAfterCurrent
        : currentTo is { } end && validFrom > end ? ContractAmendmentIssues.ValidFromAfterCurrentEnd
        : null;
}
