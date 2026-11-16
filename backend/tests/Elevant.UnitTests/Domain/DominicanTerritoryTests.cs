using Elevant.Domain.Reference;

namespace Elevant.UnitTests.Domain;

public sealed class DominicanTerritoryTests
{
    [Fact]
    public void FollowsTheOfficialDivision()
    {
        Assert.Equal(32, DominicanTerritory.Provinces.Count);
        Assert.Equal(158, DominicanTerritory.Provinces.Sum(province => province.Municipalities.Count));
        var seibo = DominicanTerritory.FindProvince("El Seibo")!;
        Assert.Equal(["El Seibo", "Miches"], seibo.Municipalities.Select(item => item.Name));
        Assert.Contains("Pedro Sánchez", seibo.Municipalities.Single(item => item.Name == "El Seibo").Districts);
    }

    [Theory]
    [InlineData("El Seibo", "Miches", null, true)]
    [InlineData("el seibo", "MICHES", "la gina", true)]
    [InlineData("El Seibo", "El Seibo", "Pedro Sánchez", true)]
    [InlineData("El Seibo", "Pedro Sánchez", null, false)]
    [InlineData("El Seibo", "Higüey", null, false)]
    [InlineData("Santo Domingo", "Boca Chica", null, true)]
    [InlineData("Narnia", null, null, false)]
    [InlineData(null, "Miches", null, false)]
    [InlineData(null, null, null, true)]
    public void ValidatesTheHierarchy(string? province, string? municipality, string? district, bool valid) =>
        Assert.Equal(valid, DominicanTerritory.IsValidLocation(province, municipality, district));

    [Theory]
    [InlineData("República Dominicana", true)]
    [InlineData("republica dominicana", true)]
    [InlineData("España", false)]
    public void RecognisesTheCountry(string country, bool expected) =>
        Assert.Equal(expected, DominicanTerritory.IsDominicanRepublic(country));
}
