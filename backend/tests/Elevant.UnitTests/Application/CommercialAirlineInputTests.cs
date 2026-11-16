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

    [Theory]
    [InlineData(null, null, true)]
    [InlineData("", "DO", true)]
    [InlineData("1-31-23456-9", "DO", true)]
    [InlineData("131234568", "DO", false)]
    [InlineData("131234569", null, false)]
    [InlineData("B85850394", "ES", false)]
    public void ADominicanAirlineTaxIdentifierIsAnRncWithItsCheckDigit(string? number, string? country, bool valid)
    {
        var input = Valid() with { TaxRegistration = number, TaxRegistrationCountryCode = country };

        Assert.Equal(valid, input.IsValid());
        if (valid && !string.IsNullOrWhiteSpace(number))
            Assert.Equal("131234569", input.TaxRegistrationOrNull()!.Number);
    }

    [Fact]
    public void AForeignAirlineKeepsItsOwnTaxIdentifier()
    {
        var input = Valid() with { CountryCode = "ES", TaxRegistration = " B85850394 ", TaxRegistrationCountryCode = "es" };

        Assert.True(input.IsValid());
        Assert.Equal(("B85850394", "ES"), (input.TaxRegistrationOrNull()!.Number, input.TaxRegistrationOrNull()!.CountryCode));
    }

    private static ManagedAirlineInput Valid() => new(
        "TEST AIRWAYS", "Test Airways", "Test Airways Ltd.", "Caribe", "DO",
        "TA", "TST", "/assets/airlines/test-airways.svg",
        "https://www.example.test/", null, false, true, null);
}
