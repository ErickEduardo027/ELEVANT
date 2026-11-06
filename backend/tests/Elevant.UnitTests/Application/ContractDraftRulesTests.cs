using System.Globalization;
using Elevant.Application.Commercial;

namespace Elevant.UnitTests.Application;

/// <summary>Readiness, package eligibility, version start and base station of contract drafts (phase 1, block B).</summary>
public sealed class ContractDraftRulesTests
{
    private static readonly DateOnly Start = new(2027, 1, 1);

    private static ContractDraftFacts Ready() => new(true, "Condiciones pactadas.", [true, true], 1, [], [], Start, null, true);

    [Fact]
    public void AReadyDraftHasNoIssues() => Assert.Empty(ContractDraftRules.Readiness(Ready()));

    [Fact]
    public void EveryCauseHasItsCodeInAFixedOrder()
    {
        var issues = ContractDraftRules.Readiness(new ContractDraftFacts(false, " ", [], 0,
            ["RAMP-CARGO · Carga y descarga"], ["PKG-TURN v2", "PKG-AC v1"], Start, Start, false));
        Assert.Equal(new[]
        {
            ContractDraftIssues.PortalAccountMissing, ContractDraftIssues.TermsMissing, ContractDraftIssues.ServicesMissing,
            ContractDraftIssues.StationsMissing, ContractDraftIssues.ServiceRetired, ContractDraftIssues.PackageNotEligible,
            ContractDraftIssues.ValidFromNotAfterCurrent,
        }, issues.Select(issue => issue.Code));
        Assert.Equal(["RAMP-CARGO · Carga y descarga"], issues.Single(issue => issue.Code == "service_retired").Subjects);
        Assert.Equal(["PKG-AC v1", "PKG-TURN v2"], issues.Single(issue => issue.Code == "package_not_eligible").Subjects);
    }

    [Fact]
    public void ARetiredPackageHasItsOwnCodeRightAfterTheIneligibleOnes()
    {
        var issues = ContractDraftRules.Readiness(Ready() with
        {
            IneligiblePackages = ["PKG-DOP v1"], RetiredPackages = ["PKG-TURN v3"], CurrentApprovedValidFrom = Start,
        });
        Assert.Equal([ContractDraftIssues.PackageNotEligible, ContractDraftIssues.PackageRetired,
            ContractDraftIssues.ValidFromNotAfterCurrent], issues.Select(issue => issue.Code));
        Assert.Equal(["PKG-TURN v3"], issues.Single(issue => issue.Code == "package_retired").Subjects);
        Assert.Empty(ContractDraftRules.Readiness(Ready() with { RetiredPackages = [] }));
    }

    [Theory]
    [InlineData(false, "rates_unconfirmed")]
    [InlineData(null, "rates_unconfirmed")]
    public void PendingAndLegacyRatesMustBeConfirmed(bool? confirmed, string code) =>
        Assert.Equal(code, Assert.Single(ContractDraftRules.Readiness(Ready() with { RateConfirmations = [true, confirmed] })).Code);

    [Fact]
    public void AFinanceReviewerMustCoverEveryStation()
    {
        Assert.Equal("finance_reviewer_missing",
            Assert.Single(ContractDraftRules.Readiness(Ready() with { FinanceReviewerAvailable = false })).Code);
        // Without stations the cause is the missing stations, not the reviewer.
        Assert.Equal("stations_missing", Assert.Single(ContractDraftRules.Readiness(Ready() with
            { StationCount = 0, FinanceReviewerAvailable = false })).Code);
    }

    [Theory]
    [InlineData("2026-12-31", true)]
    [InlineData("2027-01-01", false)]
    [InlineData("2027-01-02", false)]
    public void ANewVersionStartsAfterTheApprovedVersionInForce(string currentStart, bool expected) =>
        Assert.Equal(expected, ContractDraftRules.StartsAfterCurrent(Start, DateOnly.Parse(currentStart, CultureInfo.InvariantCulture)));

    [Fact]
    public void AFirstVersionHasNoStartToCompareWith()
    {
        Assert.True(ContractDraftRules.StartsAfterCurrent(Start, null));
        Assert.Equal("valid_from_not_after_current", Assert.Single(ContractDraftRules.Readiness(Ready() with
            { CurrentApprovedValidFrom = Start })).Code);
    }

    [Theory]
    [InlineData("USD", "2026-10-01", null, "USD", "2027-01-01", null, true)]
    [InlineData("USD", "2026-10-01", "2027-12-31", "USD", "2027-01-01", "2027-12-31", true)]
    [InlineData("USD", "2026-10-01", "2027-12-30", "USD", "2027-01-01", "2027-12-31", false)]
    [InlineData("USD", "2026-10-01", "2027-12-31", "USD", "2027-01-01", null, false)]
    [InlineData("USD", "2027-01-02", null, "USD", "2027-01-01", null, false)]
    [InlineData("USD", "2026-10-01", null, "DOP", "2027-01-01", null, false)]
    public void APackageFitsInTheVersionCurrencyAndCoversItsWholeValidity(string packageCurrency, string packageFrom,
        string? packageTo, string currency, string validFrom, string? validTo, bool expected) =>
        Assert.Equal(expected, ContractDraftRules.PackageFits(packageCurrency, DateOnly.Parse(packageFrom, CultureInfo.InvariantCulture),
            packageTo is null ? null : DateOnly.Parse(packageTo, CultureInfo.InvariantCulture), currency, DateOnly.Parse(validFrom, CultureInfo.InvariantCulture),
            validTo is null ? null : DateOnly.Parse(validTo, CultureInfo.InvariantCulture)));

    [Fact]
    public void TheBasePriceUsesTheOnlyStationOrTheAllStationsTariff()
    {
        Assert.Equal(7L, ContractDraftRules.BaseStation([7L]));
        Assert.Equal(7L, ContractDraftRules.BaseStation([7L, 7L]));
        Assert.Null(ContractDraftRules.BaseStation([7L, 9L]));
        Assert.Null(ContractDraftRules.BaseStation([]));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("    ", false)]
    [InlineData(" no  ", false)]
    [InlineData("La aerolínea desistió.", true)]
    public void ADiscardNeedsAReason(string? reason, bool expected) =>
        Assert.Equal(expected, ContractDraftRules.ValidReason(reason));

    [Fact]
    public void ADiscardReasonHasAnUpperBound()
    {
        Assert.True(ContractDraftRules.ValidReason(new string('x', ContractDraftRules.ReasonMaxLength)));
        Assert.False(ContractDraftRules.ValidReason(new string('x', ContractDraftRules.ReasonMaxLength + 1)));
    }
}
