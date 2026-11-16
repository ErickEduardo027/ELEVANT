using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>2-A and 2-B: what OCC and the superadministrator may type, and the aircraft type the provider's model suggests.</summary>
public sealed class MasterDataRulesTests
{
    [Theory]
    [InlineData(" puj ", "PUJ")]
    [InlineData("PUJA", null)]
    [InlineData("P1J", null)]
    [InlineData(null, null)]
    public void StationCodesAreTheAirportIataCode(string? value, string? expected) =>
        Assert.Equal(expected, MasterDataRules.StationCode(value));

    [Theory]
    [InlineData("a", "A")]
    [InlineData("fbo-1", "FBO-1")]
    [InlineData("-A", null)]
    [InlineData("A A", null)]
    [InlineData("ABCDEFGHIJKLMNOPQ", null)]
    public void TerminalCodes(string value, string? expected) => Assert.Equal(expected, MasterDataRules.TerminalCode(value));

    [Theory]
    [InlineData("9a", "9A")]
    [InlineData("A01", "A01")]
    [InlineData("A01-", null)]
    [InlineData("", null)]
    public void StandCodes(string value, string? expected) => Assert.Equal(expected, MasterDataRules.StandCode(value));

    [Theory]
    [InlineData("b738", "B738")]
    [InlineData("A20N", "A20N")]
    [InlineData("737", null)]
    [InlineData("B73", null)]
    [InlineData("B7389", null)]
    public void AircraftTypesUseTheFourCharacterIcaoDesignator(string value, string? expected) =>
        Assert.Equal(expected, MasterDataRules.AircraftIcao(value));

    [Fact]
    public void AnIataAircraftCodeIsOptional()
    {
        Assert.True(MasterDataRules.TryAircraftIata(" 73h ", out var iata));
        Assert.Equal("73H", iata);
        Assert.True(MasterDataRules.TryAircraftIata("  ", out var none));
        Assert.Null(none);
        Assert.False(MasterDataRules.TryAircraftIata("7377", out _));
    }

    [Theory]
    [InlineData("America/Santo_Domingo", true)]
    [InlineData("America/New_York", true)]
    [InlineData("UTC", true)]
    [InlineData("Mars/Olympus_Mons", false)]
    [InlineData("Eastern Standard Time", false)]
    [InlineData("", false)]
    public void TimeZonesAreIana(string value, bool valid) => Assert.Equal(valid, MasterDataRules.IanaTimeZone(value) is not null);

    [Fact]
    public void NamesAndSizes()
    {
        Assert.Equal("Terminal C", MasterDataRules.Name("  Terminal C ", 120));
        Assert.Null(MasterDataRules.Name("C", 120));
        Assert.Null(MasterDataRules.Name(new string('x', 121), 120));
        Assert.True(MasterDataRules.TryParseSize("Widebody", out var size));
        Assert.Equal(AircraftSizeCategory.Widebody, size);
        Assert.True(MasterDataRules.TryParseSize(null, out var any));
        Assert.Null(any);
        Assert.False(MasterDataRules.TryParseSize("Huge", out _));
        Assert.False(MasterDataRules.TryParseSize("1", out _));
    }

    [Fact]
    public void TheLongestMatchOfTheProviderModelSuggestsTheType()
    {
        var a320 = new AircraftTypeCandidate(Guid.NewGuid(), "A320", "Airbus", "A320 Development");
        var a20N = new AircraftTypeCandidate(Guid.NewGuid(), "A20N", "Airbus", "A320neo");
        var b738 = new AircraftTypeCandidate(Guid.NewGuid(), "B738", "Boeing", "737-800");
        AircraftTypeCandidate[] types = [a320, a20N, b738];

        Assert.Equal(a320.Id, AircraftModelMatcher.Suggest("Airbus A320", types));
        Assert.Equal(a20N.Id, AircraftModelMatcher.Suggest("Airbus A320 NEO", types));
        Assert.Equal(b738.Id, AircraftModelMatcher.Suggest("Boeing 737-800", types));
        Assert.Null(AircraftModelMatcher.Suggest("Boeing 787-9", types));
        Assert.Null(AircraftModelMatcher.Suggest(null, types));
        Assert.Null(AircraftModelMatcher.Suggest("Airbus A320", []));
    }

    [Fact]
    public void ATieSuggestsNothing()
    {
        AircraftTypeCandidate[] types =
        [
            new(Guid.NewGuid(), "B738", "Boeing", "737-800"),
            new(Guid.NewGuid(), "B38M", "Boeing", "737-800"),
        ];

        Assert.Null(AircraftModelMatcher.Suggest("Boeing 737-800", types));
    }
}
