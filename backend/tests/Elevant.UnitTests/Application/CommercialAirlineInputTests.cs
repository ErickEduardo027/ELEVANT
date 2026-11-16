using Elevant.Application.Abstractions.Commercial;

namespace Elevant.UnitTests.Application;

public sealed class CommercialAirlineInputTests
{
    [Fact]
    public void RequiresSourcedIdentityBeforeMarkingVerified()
    {
        var input = Valid() with { IsVerified = true, VerificationSourceUrl = null };

        Assert.False(input.IsValid());
        Assert.True((input with { VerificationSourceUrl = "https://www.iata.org/en/about/members/airline-list/" }).IsValid());
    }

    [Theory]
    [InlineData("/assets/airlines/../private.svg")]
    [InlineData("https://cdn.example.test/logo.svg")]
    public void RejectsUntrustedLogoLocation(string logoUrl)
    {
        Assert.False((Valid() with { LogoUrl = logoUrl }).IsValid());
    }

    private static ManagedAirlineInput Valid() => new(
        "TEST AIRWAYS", "Test Airways", "Test Airways Ltd.", "Caribe", "DO",
        "TA", "TST", "/assets/airlines/test-airways.svg",
        "https://www.example.test/", null, false, true, null);
}
