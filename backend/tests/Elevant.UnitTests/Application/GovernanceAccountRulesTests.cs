using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;

namespace Elevant.UnitTests.Application;

/// <summary>
/// Phase 1, block E: which existing account a request can be completed with (1-N13) and the identity
/// an operating airline keeps (1-N20).
/// </summary>
public sealed class GovernanceAccountRulesTests
{
    private static readonly ExistingAccountFacts PortalAccount =
        new(IsActive: true, IsInternal: false, IsPortalAccount: true, BelongsToOtherAirline: false);

    [Fact]
    public void APortalAccountOfTheAirlineOrWithoutAirlineCanBeLinkedAndProvisioningSaysSo()
    {
        Assert.Null(ProvisioningAccountRules.LinkIssue(PortalAccount));
        Assert.Equal(GovernanceAccountIssues.EmailHasAccount, ProvisioningAccountRules.ProvisionIssue(PortalAccount));
    }

    [Theory]
    [InlineData(true, true, true, false, "email_in_use_internal")]
    // An internal account never becomes a portal account, even when it is also disabled.
    [InlineData(false, true, true, false, "email_in_use_internal")]
    [InlineData(true, false, true, true, "email_in_use_other_airline")]
    [InlineData(false, false, true, true, "email_in_use_other_airline")]
    [InlineData(true, false, false, false, "email_in_use")]
    [InlineData(false, false, true, false, "account_disabled")]
    public void EveryOtherAccountIsRefusedWithItsReasonByLinkAndProvisioning(bool isActive, bool isInternal,
        bool isPortalAccount, bool belongsToOtherAirline, string code)
    {
        var facts = new ExistingAccountFacts(isActive, isInternal, isPortalAccount, belongsToOtherAirline);
        Assert.Equal(code, ProvisioningAccountRules.LinkIssue(facts));
        Assert.Equal(code, ProvisioningAccountRules.ProvisionIssue(facts));
    }

    private static readonly ManagedAirlineIdentity Verified =
        new("Caribe Cargo Express S.R.L.", null, "CCX", "https://aoc.example.gob.do/ccx", IsVerified: true);

    private static ManagedAirlineInput Form(ManagedAirlineIdentity identity) => new("CARIBE CARGO", "Caribe Cargo",
        identity.LegalName, "Caribe", "DO", identity.IataCode, identity.IcaoCode, null, "https://caribecargo.example.com",
        identity.VerificationSourceUrl, identity.IsVerified, IsPublished: true, Version: "AAAAAAAAB9E=");

    [Fact]
    public void TheDisplayNamePublicationLogoAndSourcesStayEditable()
    {
        var form = Form(Verified) with
        {
            DisplayName = "Caribe Cargo Express", IsPublished = false, LogoUrl = "/assets/airlines/ccx.svg",
            SourceUrl = "https://caribecargo.example.com/es", LegalName = "  Caribe Cargo Express S.R.L. ",
        };
        Assert.False(ManagedAirlineIdentityRules.ChangesIdentity(Verified, form));
    }

    [Fact]
    public void TheLegalNameCodesAndVerificationAreTheIdentity()
    {
        Assert.True(ManagedAirlineIdentityRules.ChangesIdentity(Verified, Form(Verified) with { LegalName = "Otra S.A." }));
        Assert.True(ManagedAirlineIdentityRules.ChangesIdentity(Verified, Form(Verified) with { IataCode = "C7" }));
        Assert.True(ManagedAirlineIdentityRules.ChangesIdentity(Verified, Form(Verified) with { IcaoCode = "CCY" }));
        Assert.True(ManagedAirlineIdentityRules.ChangesIdentity(Verified, Form(Verified) with { IsVerified = false }));
        // Verifying a profile that was not verified does not remove anything.
        Assert.False(ManagedAirlineIdentityRules.ChangesIdentity(Verified with { IsVerified = false }, Form(Verified)));
    }

    [Fact]
    public void SavingWithoutChangesKeepsWhenAndWhoVerified()
    {
        Assert.False(ManagedAirlineIdentityRules.RestampsVerification(Verified, Form(Verified)));
        Assert.False(ManagedAirlineIdentityRules.RestampsVerification(Verified, Form(Verified) with { DisplayName = "CCX" }));
        Assert.True(ManagedAirlineIdentityRules.RestampsVerification(Verified with { IsVerified = false }, Form(Verified)));
        Assert.True(ManagedAirlineIdentityRules.RestampsVerification(Verified,
            Form(Verified) with { VerificationSourceUrl = "https://aoc.example.gob.do/ccx/2026" }));
        Assert.True(ManagedAirlineIdentityRules.RestampsVerification(Verified, Form(Verified) with { IataCode = "C7" }));
        Assert.False(ManagedAirlineIdentityRules.RestampsVerification(Verified, Form(Verified) with { IsVerified = false }));
    }
}
