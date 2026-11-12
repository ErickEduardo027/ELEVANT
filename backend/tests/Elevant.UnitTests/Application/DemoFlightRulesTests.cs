using Elevant.Application.Integration.DemoFlights;

namespace Elevant.UnitTests.Application;

/// <summary>ADR-0041: what the superadministrator may ask for when triggering or ending a demo flight.</summary>
public sealed class DemoFlightRulesTests
{
    private static readonly Guid Station = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid Airline = Guid.Parse("21000000-0000-7000-8000-000000000001");
    private static readonly Guid AircraftType = Guid.Parse("22000000-0000-7000-8000-000000000001");
    private static readonly Guid Stand = Guid.Parse("23000000-0000-7000-8000-000000000001");

    private static CreateDemoFlightCommand Command(string? origin = "MIA", string? destination = null,
        string? standChoice = "None", Guid? standId = null, int minutes = 8, int ground = 60) =>
        new(Station, Airline, origin, destination, AircraftType, standChoice, standId, minutes, ground);

    [Theory]
    [InlineData(2, 20, true)]
    [InlineData(30, 240, true)]
    [InlineData(8, 60, true)]
    [InlineData(1, 60, false)]
    [InlineData(31, 60, false)]
    [InlineData(0, 60, false)]
    [InlineData(-8, 60, false)]
    [InlineData(8, 19, false)]
    [InlineData(8, 241, false)]
    [InlineData(8, 0, false)]
    public void RefusesMinutesAndGroundTimeOutOfRange(int minutes, int ground, bool accepted)
    {
        var input = DemoFlightRules.Normalize(Command(minutes: minutes, ground: ground));

        Assert.Equal(accepted, input is not null);
        if (input is not null) Assert.Equal((minutes, ground), (input.MinutesToOnBlock, input.GroundMinutes));
    }

    [Fact]
    public void NormalizesIataAndANullDestinationMeansTheOrigin()
    {
        var returning = DemoFlightRules.Normalize(Command(origin: " mia "));
        Assert.NotNull(returning);
        Assert.Equal(("MIA", "MIA"), (returning.OriginIata, returning.DestinationIata));

        var onward = DemoFlightRules.Normalize(Command(origin: "jfk", destination: "Yyz"));
        Assert.NotNull(onward);
        Assert.Equal(("JFK", "YYZ"), (onward.OriginIata, onward.DestinationIata));

        // Only null means «the same airport»; anything else has to be a three-letter code.
        (string? Origin, string? Destination)[] refused =
        [
            (null, null), ("", null), ("MI", null), ("MIAM", null), ("M1A", null),
            ("MIA", ""), ("MIA", "  "), ("MIA", "JF"), ("MIA", "KJFK"), (null, "JFK"),
        ];
        Assert.All(refused, pair => Assert.Null(DemoFlightRules.Normalize(Command(pair.Origin, pair.Destination))));
    }

    [Fact]
    public void RefusesEmptyIdentifiers()
    {
        var valid = DemoFlightRules.Normalize(Command());
        Assert.NotNull(valid);
        Assert.Equal((Station, Airline, AircraftType), (valid.StationId, valid.AirlineId, valid.AircraftTypeId));

        Assert.Null(DemoFlightRules.Normalize(Command() with { StationId = Guid.Empty }));
        Assert.Null(DemoFlightRules.Normalize(Command() with { AirlineId = Guid.Empty }));
        Assert.Null(DemoFlightRules.Normalize(Command() with { AircraftTypeId = Guid.Empty }));
    }

    [Fact]
    public void StandChoiceIsNoneOrSpecificAndSpecificNeedsItsStand()
    {
        var none = DemoFlightRules.Normalize(Command(standChoice: "None"));
        Assert.NotNull(none);
        Assert.Equal(DemoStandChoice.None, none.StandChoice);
        Assert.Null(none.StandId);

        var specific = DemoFlightRules.Normalize(Command(standChoice: "Specific", standId: Stand));
        Assert.NotNull(specific);
        Assert.Equal(DemoStandChoice.Specific, specific.StandChoice);
        Assert.Equal(Stand, specific.StandId);

        Assert.Null(DemoFlightRules.Normalize(Command(standChoice: "Specific")));
        Assert.Null(DemoFlightRules.Normalize(Command(standChoice: "Specific", standId: Guid.Empty)));
        Assert.Null(DemoFlightRules.Normalize(Command(standChoice: "None", standId: Stand)));
        // Exact names only, never a number; the random draw arrives with the Punta Cana stands (PR A2).
        string?[] unknown = [null, "", "none", "SPECIFIC", " None", "None ", "0", "1", "None,Specific", "Random"];
        Assert.All(unknown, choice =>
        {
            Assert.Null(DemoFlightRules.Normalize(Command(standChoice: choice)));
            Assert.Null(DemoFlightRules.Normalize(Command(standChoice: choice, standId: Stand)));
        });
    }

    [Theory]
    [InlineData("PUJ", "PUJ", "MIA", true)]
    [InlineData("PUJ", "MIA", "PUJ", true)]
    [InlineData("PUJ", "PUJ", "PUJ", true)]
    [InlineData("puj", "MIA", "PUJ", true)]
    [InlineData("PUJ", "MIA", "MIA", false)]
    [InlineData("PUJ", "MIA", "JFK", false)]
    [InlineData("SDQ", "MIA", "PUJ", false)]
    public void RefusesTheStationsOwnAirportAsOriginOrDestination(string stationIata, string originIata,
        string destinationIata, bool usesStationAirport) =>
        Assert.Equal(usesStationAirport, DemoFlightRules.UsesStationAirport(stationIata, originIata, destinationIata));

    [Fact]
    public void ParsesTheCancelIntentByItsExactName()
    {
        Assert.Equal(DemoFlightIntent.Cancel, DemoFlightRules.ParseIntent("Cancel"));
        Assert.Equal(DemoFlightIntent.Finish, DemoFlightRules.ParseIntent("Finish"));

        string?[] unknown = [null, "", "cancel", "FINISH", " Cancel", "Finish ", "0", "1", "Cancel,Finish", "Dismiss"];
        Assert.All(unknown, value => Assert.Null(DemoFlightRules.ParseIntent(value)));
    }
}
