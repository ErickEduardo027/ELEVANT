using System.Globalization;
using Elevant.Application.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>2-C: only a version both parties signed over the same content changes what is billed.</summary>
public sealed class ContractVersionGovernanceTests
{
    private const string First = "1111111111111111111111111111111111111111111111111111111111111111";
    private const string Second = "2222222222222222222222222222222222222222222222222222222222222222";

    [Fact]
    public void BothPartiesMustSignTheSameContent()
    {
        Assert.True(ContractVersionGovernance.SignedByBoth([new(ContractSignatureParty.Airline, First),
            new(ContractSignatureParty.Aviam, First.ToUpperInvariant())]));
        // 2-N28: two signatures over different content never make a signed version.
        Assert.False(ContractVersionGovernance.SignedByBoth([new(ContractSignatureParty.Airline, First),
            new(ContractSignatureParty.Aviam, Second)]));
        Assert.False(ContractVersionGovernance.SignedByBoth([new(ContractSignatureParty.Airline, First)]));
        Assert.False(ContractVersionGovernance.SignedByBoth([]));
    }

    [Theory]
    [InlineData(ContractVersionStatus.Superseded, false, false, ContractStatus.Active, true)]
    [InlineData(ContractVersionStatus.Approved, true, false, ContractStatus.Active, true)]
    [InlineData(ContractVersionStatus.Approved, true, true, ContractStatus.Draft, true)]
    // The first approved version of a contract activated before signatures existed keeps governing,
    // even after a one-party signature on it.
    [InlineData(ContractVersionStatus.Approved, false, true, ContractStatus.Active, true)]
    [InlineData(ContractVersionStatus.Approved, false, true, ContractStatus.Suspended, true)]
    // A new contract activates only with a version both parties signed.
    [InlineData(ContractVersionStatus.Approved, false, true, ContractStatus.Draft, false)]
    // A renewal or an amendment Finance approved does not govern until both parties sign it.
    [InlineData(ContractVersionStatus.Approved, false, false, ContractStatus.Active, false)]
    [InlineData(ContractVersionStatus.PendingFinanceApproval, false, true, ContractStatus.Active, false)]
    [InlineData(ContractVersionStatus.Rejected, true, true, ContractStatus.Active, false)]
    [InlineData(ContractVersionStatus.Draft, false, true, ContractStatus.Active, false)]
    public void WhichVersionGoverns(ContractVersionStatus status, bool signedByBoth, bool firstApproved,
        ContractStatus contractStatus, bool expected) =>
        Assert.Equal(expected, ContractVersionGovernance.Governs(status, signedByBoth, firstApproved, contractStatus));

    [Theory]
    [InlineData(null, "2027-01-01", "2026-12-31")]
    [InlineData("2026-12-31", "2027-01-01", "2026-12-31")]
    // A mid-term amendment ends the version in force the day before it starts.
    [InlineData("2027-06-30", "2027-01-01", "2026-12-31")]
    // A version that already ended keeps its end.
    [InlineData("2026-11-30", "2027-01-01", "2026-11-30")]
    public void TheReplacedVersionEndsTheDayBeforeTheNewStart(string? end, string nextStart, string expected) =>
        Assert.Equal(Day(expected), ContractVersionGovernance.SupersededEnd(
            end is null ? null : Day(end), Day(nextStart)));

    [Fact]
    public void TheCoverageEndsWithTheLatestGoverningVersionAndIsOpenWithoutAnEnd()
    {
        Assert.Null(ContractVersionGovernance.CoverageEnd([]));
        Assert.Equal(Day("2026-12-31"), ContractVersionGovernance.CoverageEnd([Day("2026-12-31")]));
        Assert.Equal(Day("2026-12-31"), ContractVersionGovernance.CoverageEnd([Day("2026-12-31"), Day("2026-11-14")]));
        Assert.Equal(DateOnly.MaxValue, ContractVersionGovernance.CoverageEnd([Day("2026-12-31"), null]));
        Assert.Equal(DateOnly.MaxValue, ContractVersionGovernance.CoverageEnd([null, Day("2026-12-31")]));
    }

    [Fact]
    public void AnAmendmentThatKeepsTheEndKeepsTheCoverageEndAndARenewalMovesIt()
    {
        // 2-N12: v1 ends on 31 December; the amendment from 15 November copies that end and v1 ends the day before.
        var before = ContractVersionGovernance.CoverageEnd([Day("2026-12-31")]);
        var amended = ContractVersionGovernance.CoverageEnd([
            ContractVersionGovernance.SupersededEnd(Day("2026-12-31"), Day("2026-11-15")), Day("2026-12-31")]);
        var renewed = ContractVersionGovernance.CoverageEnd([
            ContractVersionGovernance.SupersededEnd(Day("2026-12-31"), Day("2027-01-01")), Day("2027-12-31")]);
        var shortened = ContractVersionGovernance.CoverageEnd([
            ContractVersionGovernance.SupersededEnd(Day("2026-12-31"), Day("2026-11-15")), Day("2026-11-30")]);

        Assert.Equal(before, amended);
        Assert.Equal(Day("2027-12-31"), renewed);
        Assert.Equal(Day("2026-11-30"), shortened);
    }

    private static DateOnly Day(string value) => DateOnly.ParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture);
}
