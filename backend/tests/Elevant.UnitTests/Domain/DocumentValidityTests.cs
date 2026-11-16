using Elevant.Domain.Governance;

namespace Elevant.UnitTests.Domain;

public sealed class DocumentValidityTests
{
    private static readonly DateOnly AsOf = new(2026, 10, 13);

    [Theory]
    [InlineData("2026-01-01", "2026-10-12", DocumentValidity.Expired)]
    [InlineData("2026-01-01", "2026-10-13", DocumentValidity.ExpiringSoon)]
    [InlineData("2026-01-01", "2026-11-12", DocumentValidity.ExpiringSoon)]
    [InlineData("2026-01-01", "2026-11-13", DocumentValidity.Valid)]
    [InlineData("2026-10-14", "2027-10-14", DocumentValidity.Upcoming)]
    [InlineData("2026-10-13", "2099-12-31", DocumentValidity.Valid)]
    public void ClassifiesAgainstTheReferenceDay(string startsOn, string expiresOn,
        DocumentValidity expected) =>
        Assert.Equal(expected, DocumentValidityRules.Classify(
            DateOnly.Parse(startsOn), DateOnly.Parse(expiresOn), AsOf));

    [Fact]
    public void ExpiringSoonLimitNeverOverflows()
    {
        Assert.Equal(new DateOnly(2026, 11, 12), DocumentValidityRules.ExpiringSoonLimit(AsOf));
        Assert.Equal(DateOnly.MaxValue, DocumentValidityRules.ExpiringSoonLimit(DateOnly.MaxValue));
    }

    [Theory]
    [InlineData("Valid", true)]
    [InlineData("ExpiringSoon", true)]
    [InlineData("expired", false)]
    [InlineData("1", false)]
    [InlineData("7", false)]
    [InlineData(null, false)]
    public void ParsesOnlyExactNames(string? value, bool expected) =>
        Assert.Equal(expected, DocumentValidityRules.TryParse(value, out _));
}
