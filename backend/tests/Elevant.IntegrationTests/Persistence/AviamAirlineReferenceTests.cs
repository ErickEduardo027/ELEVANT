using Elevant.Domain.Validation;
using Elevant.Infrastructure.Persistence.Seed;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// The AVIAM reference: every active airline has a sourced identity, the verified designators belong to one airline
/// each (ux_airline_profiles_verified_iata/icao), and the FICTITIOUS Development RNCs are distinct 9-digit RNCs.
/// </summary>
public sealed class AviamAirlineReferenceTests
{
    private static IEnumerable<string> Active => AviamAirlineReference.Research.Keys
        .Where(name => !AviamAirlineReference.Archived.Contains(name));

    [Fact]
    public void EveryActiveAirlineButItsHistoricalBrandHasASourcedIdentity()
    {
        Assert.Equal(["ARKEFLY"], Active.Where(name => !AviamAirlineReference.Verified.ContainsKey(name)));
        Assert.All(AviamAirlineReference.Verified, item =>
        {
            Assert.True(AviamAirlineReference.Research.ContainsKey(item.Key), item.Key);
            Assert.True(AirlineCodes.IsIcao(item.Value.Icao), item.Key);
            Assert.True(item.Value.Iata is null || AirlineCodes.IsIata(item.Value.Iata), item.Key);
            Assert.StartsWith("https://", item.Value.Source, StringComparison.Ordinal);
            Assert.False(string.IsNullOrWhiteSpace(item.Value.Legal), item.Key);
        });
    }

    [Fact]
    public void AVerifiedDesignatorBelongsToOneAirline()
    {
        var identities = AviamAirlineReference.Verified.Values.ToArray();
        Assert.Equal(identities.Length, identities.Select(item => item.Icao).Distinct().Count());
        var iata = identities.Select(item => item.Iata).OfType<string>().ToArray();
        Assert.Equal(iata.Length, iata.Distinct().Count());
    }

    [Fact]
    public void TheDevelopmentRncsAreDistinctNineDigitRncsOfActiveAirlines()
    {
        var rncs = AviamAirlineReference.DevelopmentTaxRegistrations;
        Assert.Equal(Active.Order(StringComparer.Ordinal), rncs.Keys.Order(StringComparer.Ordinal));
        Assert.Equal(rncs.Count, rncs.Values.Distinct().Count());
        Assert.All(rncs.Values, value =>
        {
            Assert.Matches("^13[01][0-9]{6}$", value);
            Assert.Equal(value, TaxRegistrations.Normalize(value, "DO")?.Number);
            // Shaped like a company RNC: its modulus-11 check digit holds although the rule is not enforced.
            Assert.Equal(value, IdentityDocuments.Normalize(IdentityDocumentKind.Rnc, value));
        });
    }
}
