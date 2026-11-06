using System.Globalization;
using Elevant.Application.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>An amendment starts after the approved version in force and not after its end (1-C).</summary>
public sealed class ContractAmendmentTests
{
    private static readonly DateOnly CurrentFrom = new(2026, 1, 1);
    private static readonly DateOnly CurrentTo = new(2026, 12, 31);

    [Theory]
    [InlineData("2025-12-31", "valid_from_not_after_current")]
    [InlineData("2026-01-01", "valid_from_not_after_current")]
    [InlineData("2026-01-02", null)]
    [InlineData("2026-12-31", null)]
    [InlineData("2027-01-01", "valid_from_after_current_end")]
    public void TheStartFallsWithinTheVersionItAmends(string validFrom, string? issue) =>
        Assert.Equal(issue, ContractAmendment.StartIssue(DateOnly.Parse(validFrom, CultureInfo.InvariantCulture), CurrentFrom,
            CurrentTo));

    [Fact]
    public void AnOpenEndedVersionHasNoEndToRespect() =>
        Assert.Null(ContractAmendment.StartIssue(new DateOnly(2099, 1, 1), CurrentFrom, null));

    [Theory]
    [InlineData(ContractStatus.Active, true)]
    [InlineData(ContractStatus.Suspended, true)]
    [InlineData(ContractStatus.Draft, false)]
    [InlineData(ContractStatus.Expired, false)]
    [InlineData(ContractStatus.Terminated, false)]
    public void OnlyAContractInForceOrSuspendedIsAmended(ContractStatus status, bool expected) =>
        Assert.Equal(expected, ContractAmendment.CanAmend(status));
}
