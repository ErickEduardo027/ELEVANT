using Elevant.Application.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>1-N03 and 1-N11: «Ocultar» keeps the service operable, «Dar de baja» needs no contract in force.</summary>
public sealed class CommercialServiceRetirementTests
{
    private static readonly DateOnly Today = new(2026, 11, 6);

    [Theory]
    [InlineData(ContractStatus.Active, ContractVersionStatus.Approved, null)]
    [InlineData(ContractStatus.Active, ContractVersionStatus.Approved, "2026-11-06")]
    [InlineData(ContractStatus.Suspended, ContractVersionStatus.Approved, "2027-01-31")]
    [InlineData(ContractStatus.Active, ContractVersionStatus.Superseded, "2026-12-31")]
    // Signing activates a draft contract whose version Finance approved.
    [InlineData(ContractStatus.Draft, ContractVersionStatus.Approved, "2027-12-31")]
    // A version Finance is approving keeps the service, whatever its dates.
    [InlineData(ContractStatus.Draft, ContractVersionStatus.PendingFinanceApproval, "2025-01-01")]
    [InlineData(ContractStatus.Active, ContractVersionStatus.PendingFinanceApproval, null)]
    // One day of margin for the stations whose local date is behind UTC.
    [InlineData(ContractStatus.Active, ContractVersionStatus.Approved, "2026-11-05")]
    public void AContractInForceOrInApprovalKeepsItsServices(ContractStatus contract, ContractVersionStatus version,
        string? validTo)
    {
        Assert.True(CommercialServiceRetirement.KeepsServiceInForce(contract, version, Date(validTo), Today));
    }

    [Theory]
    // Draft versions keep a retired service marked and block their submission instead (1-N10).
    [InlineData(ContractStatus.Draft, ContractVersionStatus.Draft, null)]
    [InlineData(ContractStatus.Active, ContractVersionStatus.Draft, null)]
    [InlineData(ContractStatus.Active, ContractVersionStatus.Rejected, null)]
    [InlineData(ContractStatus.Active, ContractVersionStatus.Approved, "2026-11-04")]
    [InlineData(ContractStatus.Active, ContractVersionStatus.Superseded, "2026-10-31")]
    [InlineData(ContractStatus.Terminated, ContractVersionStatus.Approved, null)]
    [InlineData(ContractStatus.Expired, ContractVersionStatus.Approved, "2027-01-31")]
    [InlineData(ContractStatus.Terminated, ContractVersionStatus.PendingFinanceApproval, null)]
    public void ClosedContractsEndedVersionsAndDraftsDoNotBlockTheRetirement(ContractStatus contract,
        ContractVersionStatus version, string? validTo)
    {
        Assert.False(CommercialServiceRetirement.KeepsServiceInForce(contract, version, Date(validTo), Today));
    }

    [Fact]
    public void TheFormNeverRetiresAnActiveService()
    {
        Assert.Equal("retirement_command_required",
            CommercialServiceRetirement.UpdateIssue(true, true, false, false, false));
        Assert.Equal("retirement_command_required",
            CommercialServiceRetirement.UpdateIssue(true, false, false, false, false));
        // Hiding it keeps it active and operable.
        Assert.Null(CommercialServiceRetirement.UpdateIssue(true, true, true, false, false));
    }

    [Fact]
    public void ARetiredServiceIsReactivatedBeforeItIsPublished()
    {
        Assert.Equal("service_retired", CommercialServiceRetirement.UpdateIssue(false, false, false, true, false));
        // Editing its texts keeps it retired; reactivating it is an update.
        Assert.Null(CommercialServiceRetirement.UpdateIssue(false, false, false, false, false));
        Assert.Null(CommercialServiceRetirement.UpdateIssue(false, false, true, false, false));
    }

    [Fact]
    public void AnApprovedClosureIsReopenedFromTheClosureNotFromTheForm()
    {
        Assert.Equal("closure_requires_reopen", CommercialServiceRetirement.UpdateIssue(true, false, true, true, true));
        Assert.Null(CommercialServiceRetirement.UpdateIssue(true, false, true, true, false));
        // A service that is already public is not republished.
        Assert.Null(CommercialServiceRetirement.UpdateIssue(true, true, true, true, true));
    }

    [Fact]
    public void TheRetirementReasonHasTheClosureBounds()
    {
        Assert.False(CommercialServiceRetirement.TryNormalizeReason("corto", out _));
        Assert.False(CommercialServiceRetirement.TryNormalizeReason(new string('x', 1001), out _));
        Assert.True(CommercialServiceRetirement.TryNormalizeReason("  Ya no se presta en AVIAM  ", out var reason));
        Assert.Equal("Ya no se presta en AVIAM", reason);
    }

    private static DateOnly? Date(string? value) => value is null ? null : DateOnly.Parse(value,
        System.Globalization.CultureInfo.InvariantCulture);
}
