namespace Elevant.Application.Commercial;

/// <summary>
/// Stable codes of why a contract draft cannot go to Finance yet (phase 1, block B). The submission,
/// the readiness endpoint and the «Enviar a Finanzas» button use the same codes, in this order.
/// </summary>
public static class ContractDraftIssues
{
    public const string PortalAccountMissing = "portal_account_missing";
    public const string TermsMissing = "terms_missing";
    public const string ServicesMissing = "services_missing";
    public const string RatesUnconfirmed = "rates_unconfirmed";
    public const string StationsMissing = "stations_missing";
    public const string ServiceRetired = "service_retired";
    public const string PackageNotEligible = "package_not_eligible";
    public const string ValidFromNotAfterCurrent = "valid_from_not_after_current";
    public const string FinanceReviewerMissing = "finance_reviewer_missing";
}

/// <summary>What the readiness check needs to know about one draft version; the store gathers it.</summary>
/// <param name="PortalAccountReady">The airline has a portal account (active or invited) to review and sign.</param>
/// <param name="Terms">Terms of the version as saved.</param>
/// <param name="RateConfirmations">One entry per service rate: confirmed, pending or legacy (null).</param>
/// <param name="StationCount">Stations the version covers.</param>
/// <param name="RetiredServices">Services of the draft that the catalog retired (inactive).</param>
/// <param name="IneligiblePackages">Linked packages outside the currency or validity of the version.</param>
/// <param name="ValidFrom">Start of the version.</param>
/// <param name="CurrentApprovedValidFrom">Start of the latest approved version of the contract, if any.</param>
/// <param name="FinanceReviewerAvailable">Someone in Finance may decide and covers every station of the version.</param>
public sealed record ContractDraftFacts(
    bool PortalAccountReady,
    string? Terms,
    IReadOnlyCollection<bool?> RateConfirmations,
    int StationCount,
    IReadOnlyCollection<string> RetiredServices,
    IReadOnlyCollection<string> IneligiblePackages,
    DateOnly ValidFrom,
    DateOnly? CurrentApprovedValidFrom,
    bool FinanceReviewerAvailable);

/// <summary>One reason the draft is not ready, with the services or packages it is about.</summary>
public sealed record ContractDraftIssue(string Code, IReadOnlyList<string> Subjects);

/// <summary>
/// Pure rules of a contract draft: readiness for Finance, package eligibility, the start of a new
/// version against the version in force, and the station whose Finance base price applies.
/// </summary>
public static class ContractDraftRules
{
    /// <summary>Longest reason accepted when a draft or a contract is discarded.</summary>
    public const int ReasonMaxLength = 500;

    /// <summary>Every cause that blocks the submission to Finance, in a fixed order; empty when ready.</summary>
    public static IReadOnlyList<ContractDraftIssue> Readiness(ContractDraftFacts facts)
    {
        ArgumentNullException.ThrowIfNull(facts);
        var issues = new List<ContractDraftIssue>();
        void Add(bool blocked, string code, IEnumerable<string>? subjects = null)
        {
            if (blocked) issues.Add(new ContractDraftIssue(code, subjects?.Order(StringComparer.Ordinal).ToArray() ?? []));
        }
        Add(!facts.PortalAccountReady, ContractDraftIssues.PortalAccountMissing);
        Add(string.IsNullOrWhiteSpace(facts.Terms), ContractDraftIssues.TermsMissing);
        Add(facts.RateConfirmations.Count == 0, ContractDraftIssues.ServicesMissing);
        Add(facts.RateConfirmations.Any(confirmed => confirmed != true), ContractDraftIssues.RatesUnconfirmed);
        Add(facts.StationCount == 0, ContractDraftIssues.StationsMissing);
        Add(facts.RetiredServices.Count > 0, ContractDraftIssues.ServiceRetired, facts.RetiredServices);
        Add(facts.IneligiblePackages.Count > 0, ContractDraftIssues.PackageNotEligible, facts.IneligiblePackages);
        Add(!StartsAfterCurrent(facts.ValidFrom, facts.CurrentApprovedValidFrom), ContractDraftIssues.ValidFromNotAfterCurrent);
        Add(facts.StationCount > 0 && !facts.FinanceReviewerAvailable, ContractDraftIssues.FinanceReviewerMissing);
        return issues;
    }

    /// <summary>
    /// A package fits a version when it is in the version currency, starts on or before the version
    /// and covers it to its end (an open-ended version needs an open-ended package).
    /// </summary>
    public static bool PackageFits(string packageCurrency, DateOnly packageValidFrom, DateOnly? packageValidTo,
        string currency, DateOnly validFrom, DateOnly? validTo) =>
        string.Equals(packageCurrency, currency, StringComparison.Ordinal) && packageValidFrom <= validFrom &&
        (packageValidTo is null || validTo is not null && packageValidTo >= validTo);

    /// <summary>
    /// A renewal or an amendment starts after the start of the latest approved version
    /// (<c>valid_from_not_after_current</c>); a first version has nothing to compare with.
    /// </summary>
    public static bool StartsAfterCurrent(DateOnly validFrom, DateOnly? currentApprovedValidFrom) =>
        currentApprovedValidFrom is not { } current || validFrom > current;

    /// <summary>
    /// The station whose Finance base price applies to a version: its only station, or none (the
    /// all-stations tariff) when it has several. The draft creation, the editor and the Finance
    /// comparison all use it, so the base price is the same everywhere (1-N06).
    /// </summary>
    public static long? BaseStation(IReadOnlyCollection<long> stationIds)
    {
        ArgumentNullException.ThrowIfNull(stationIds);
        var distinct = stationIds.Distinct().Take(2).ToArray();
        return distinct.Length == 1 ? distinct[0] : null;
    }

    /// <summary>A discard reason: 5 to <see cref="ReasonMaxLength"/> characters after trimming.</summary>
    public static bool ValidReason(string? reason) => reason?.Trim().Length is >= 5 and <= ReasonMaxLength;
}
