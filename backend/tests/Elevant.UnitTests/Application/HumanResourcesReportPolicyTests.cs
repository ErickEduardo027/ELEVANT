using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;

namespace Elevant.UnitTests.Application;

public sealed class HumanResourcesReportPolicyTests
{
    [Fact]
    public void DateRangeAllowsAYearOf366InclusiveDaysButNotMore()
    {
        var first = new DateOnly(2026, 1, 1);

        Assert.True(HumanResourcesReportPolicy.ValidRange(first, new DateOnly(2026, 10, 31)));
        Assert.True(HumanResourcesReportPolicy.ValidRange(first, new DateOnly(2027, 1, 1)));
        Assert.False(HumanResourcesReportPolicy.ValidRange(first, new DateOnly(2027, 1, 2)));
        Assert.False(HumanResourcesReportPolicy.ValidRange(first, new DateOnly(2025, 12, 31)));
    }

    [Fact]
    public void ExpirationFiltersAreExactAndNotAcceptedByOtherReports()
    {
        Assert.True(HumanResourcesReportPolicy.ValidExpirationFilters(
            HumanResourcesReportKind.Expirations, "Qualification", "Current"));
        Assert.True(HumanResourcesReportPolicy.ValidExpirationFilters(
            HumanResourcesReportKind.Expirations, "Permit", "Expired"));
        Assert.False(HumanResourcesReportPolicy.ValidExpirationFilters(
            HumanResourcesReportKind.Expirations, "qualification", null));
        Assert.False(HumanResourcesReportPolicy.ValidExpirationFilters(
            HumanResourcesReportKind.Expirations, null, "Unknown"));
        Assert.False(HumanResourcesReportPolicy.ValidExpirationFilters(
            HumanResourcesReportKind.StaffDistribution, "Permit", null));
    }
}
