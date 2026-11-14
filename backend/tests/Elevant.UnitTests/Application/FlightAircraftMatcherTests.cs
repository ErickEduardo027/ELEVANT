using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0042 (contracts 1.3): a live aircraft is an ELEVANT flight by its registration first, then by its callsign; only
/// flights inside their window are candidates and demo flights never are; one flight per aircraft and one aircraft per
/// flight. Every registration, callsign and address here is invented.
/// </summary>
public sealed class FlightAircraftMatcherTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 13, 16, 0, 0, TimeSpan.Zero);

    [Fact]
    public void MatchesByRegistrationBeforeCallsign()
    {
        MapFlightMatchKey[] flights =
        [
            Flight("p:registration", number: "ZZ555", registration: "ZZ-ABC"),
            Flight("p:callsign", number: "ZZ123"),
        ];

        // Both sides know the registration: it decides, whatever the callsign says, written with or without hyphens,
        // spaces or capitals.
        Assert.Equal(new FlightMatch("p:registration", "Registration"),
            Only(Match([Plane("0c0001", callsign: "ZZA123", registration: " zzabc ")], flights)));
        Assert.Equal(new FlightMatch("p:registration", FlightMatch.ByRegistration),
            Only(Match([Plane("0c0001", callsign: "ZZA123", registration: "ZZ-A BC")], flights)));

        // The aircraft does not broadcast a registration, or no candidate has its registration: the callsign decides.
        Assert.Equal(new FlightMatch("p:callsign", "Callsign"), Only(Match([Plane("0c0001", callsign: "ZZA123")], flights)));
        Assert.Equal(new FlightMatch("p:callsign", FlightMatch.ByCallsign),
            Only(Match([Plane("0c0001", callsign: " zza 123", registration: "ZZ-XYZ")], flights)));

        // Neither: no flight.
        Assert.Empty(Match([Plane("0c0001", callsign: "YYB77", registration: "ZZ-XYZ")], flights));
        Assert.Empty(Match([Plane("0c0001")], flights));
        Assert.Empty(Match([], flights));
        Assert.Empty(Match([Plane("0c0001", callsign: "ZZA123")], []));
    }

    [Fact]
    public void BuildsTheIcaoCallsignWithAndWithoutLeadingZeros()
    {
        Assert.Equal("ZZA123", FlightAircraftMatcher.IcaoCallsign("ZZA", "ZZ0123"));
        Assert.Equal("ZZA123", FlightAircraftMatcher.IcaoCallsign(" zza ", "zz 0123"));
        Assert.Equal("ZZA9001", FlightAircraftMatcher.IcaoCallsign("ZZA", "ZZ9001"));
        // A number written with the ICAO designator, only digits, all zeros or with a letter after it.
        Assert.Equal("ZZA123", FlightAircraftMatcher.IcaoCallsign("ZZA", "ZZA0123"));
        Assert.Equal("ZZA7", FlightAircraftMatcher.IcaoCallsign("ZZA", "007"));
        Assert.Equal("ZZA0", FlightAircraftMatcher.IcaoCallsign("ZZA", "ZZ0000"));
        Assert.Equal("ZZA123A", FlightAircraftMatcher.IcaoCallsign("ZZA", "ZZ0123A"));
        // An IATA designator with a digit in it.
        Assert.Equal("QQB123", FlightAircraftMatcher.IcaoCallsign("QQB", "Q70123"));
        // Not three letters, or no number of one to four digits: no callsign.
        Assert.Null(FlightAircraftMatcher.IcaoCallsign("ZZ", "ZZ0123"));
        Assert.Null(FlightAircraftMatcher.IcaoCallsign("Z1A", "ZZ0123"));
        Assert.Null(FlightAircraftMatcher.IcaoCallsign("ZZA", "ZZ"));
        Assert.Null(FlightAircraftMatcher.IcaoCallsign("ZZA", "ZZ12345"));

        // The aircraft may broadcast the number without or with its zeros.
        MapFlightMatchKey[] flights = [Flight("p:1", number: "ZZ0123")];
        Assert.Equal("p:1", Only(Match([Plane("0c0001", callsign: "ZZA123")], flights)).FlightKey);
        Assert.Equal("p:1", Only(Match([Plane("0c0001", callsign: "ZZA0123")], flights)).FlightKey);
        Assert.Empty(Match([Plane("0c0001", callsign: "ZZA1230")], flights));
        Assert.Empty(Match([Plane("0c0001", callsign: "YYB123")], flights));
    }

    [Fact]
    public void MatchesTheIataCallsignAndTheRawFlightNumber()
    {
        // The IATA designator with the number, without or with its zeros (the second is also the number as written).
        MapFlightMatchKey[] flights = [Flight("p:1", number: "ZZ0123")];
        Assert.Equal(new FlightMatch("p:1", "Callsign"), Only(Match([Plane("0c0001", callsign: "ZZ123")], flights)));
        Assert.Equal(new FlightMatch("p:1", "Callsign"), Only(Match([Plane("0c0001", callsign: "ZZ0123")], flights)));

        // A flight number written with the ICAO designator: as written, and every other form.
        MapFlightMatchKey[] written = [Flight("p:2", number: "ZZA0456")];
        Assert.Equal("p:2", Only(Match([Plane("0c0001", callsign: "ZZA0456")], written)).FlightKey);
        Assert.Equal("p:2", Only(Match([Plane("0c0001", callsign: "ZZA456")], written)).FlightKey);
        Assert.Equal("p:2", Only(Match([Plane("0c0001", callsign: "ZZ456")], written)).FlightKey);

        // An airline without an IATA designator has no IATA callsign.
        MapFlightMatchKey[] noIata = [Flight("p:3", number: "ZZA77", iata: null)];
        Assert.Empty(Match([Plane("0c0001", callsign: "ZZ77")], noIata));
        Assert.Equal("p:3", Only(Match([Plane("0c0001", callsign: "ZZA77")], noIata)).FlightKey);

        // A flight number of another shape is still its own callsign.
        MapFlightMatchKey[] charter = [Flight("p:4", number: "CHARTER1")];
        Assert.Equal("p:4", Only(Match([Plane("0c0001", callsign: "charter1")], charter)).FlightKey);
    }

    [Theory]
    [InlineData("Arrival", -7_200, true)]
    [InlineData("Arrival", -7_201, false)]
    [InlineData("Arrival", 21_600, true)]
    [InlineData("Arrival", 21_601, false)]
    [InlineData("Departure", -3_600, true)]
    [InlineData("Departure", -3_601, false)]
    [InlineData("Departure", 10_800, true)]
    [InlineData("Departure", 10_801, false)]
    [InlineData("departure", 0, true)]
    [InlineData("Unknown", 0, false)]
    public void IgnoresFlightsOutsideTheirWindow(string direction, int secondsFromNow, bool candidate)
    {
        // Arrivals from two hours ago to six ahead, departures from one hour ago to three ahead; by registration or by
        // callsign alike.
        MapFlightMatchKey[] flights = [Flight("p:1", direction: direction, registration: "ZZ-ABC", seconds: secondsFromNow)];
        Assert.Equal(candidate, Match([Plane("0c0001", registration: "ZZABC")], flights).ContainsKey("0c0001"));
        Assert.Equal(candidate, Match([Plane("0c0001", callsign: "ZZA123")], flights).ContainsKey("0c0001"));
    }

    [Fact]
    public void NeverMatchesADemoFlight()
    {
        var demo = Flight("p:demo", number: "ZZ9001", registration: "HIDM01", demo: true);
        Assert.Empty(Match([Plane("0c0001", callsign: "ZZA9001", registration: "HIDM01")], [demo]));

        // Next to a real flight with the same number, the aircraft is the real flight's.
        var real = Flight("p:real", number: "ZZ9001", seconds: 3_600);
        Assert.Equal(new FlightMatch("p:real", "Callsign"),
            Only(Match([Plane("0c0001", callsign: "ZZA9001", registration: "HIDM01")], [demo, real])));
    }

    [Fact]
    public void PrefersTheExactCallsignThenTheNextFlightThenTheNearest()
    {
        // The two legs of one visit are planned with the same registration.
        var arrival = Flight("p:arrival", number: "ZZ0123", registration: "ZZ-ABC", seconds: 1_800);
        var departure = Flight("p:departure", direction: "Departure", number: "ZZ0124", registration: "ZZ-ABC", seconds: 5_400);
        MapFlightMatchKey[] visit = [arrival, departure];

        // The exact ICAO callsign wins over the earlier flight; another callsign of the flight wins over none.
        Assert.Equal("p:departure", Only(Match([Plane("0c0001", callsign: "ZZA124", registration: "ZZABC")], visit)).FlightKey);
        Assert.Equal("p:departure", Only(Match([Plane("0c0001", callsign: "ZZ0124", registration: "ZZABC")], visit)).FlightKey);

        // Without a callsign: the flight that has not happened yet, the earliest first.
        Assert.Equal("p:arrival", Only(Match([Plane("0c0001", registration: "ZZABC")], visit)).FlightKey);

        // The arrival landed half an hour ago: the departure that has not happened yet comes first, however near it is.
        var landed = arrival with { BestTime = Now.AddMinutes(-30), Happened = true };
        Assert.Equal("p:departure", Only(Match([Plane("0c0001", registration: "ZZABC")], [landed, departure])).FlightKey);

        // Both happened: the nearest in time.
        var gone = departure with { BestTime = Now.AddMinutes(-20), Happened = true };
        Assert.Equal("p:departure", Only(Match([Plane("0c0001", registration: "ZZABC")],
            [arrival with { BestTime = Now.AddMinutes(-90), Happened = true }, gone])).FlightKey);
        Assert.Equal("p:arrival", Only(Match([Plane("0c0001", registration: "ZZABC")],
            [arrival with { BestTime = Now.AddMinutes(-10), Happened = true }, gone])).FlightKey);

        // By callsign, two legs with the same number: the next one.
        MapFlightMatchKey[] sameNumber =
        [
            Flight("p:out", direction: "Departure", number: "ZZ0123", seconds: 7_200),
            Flight("p:in", number: "ZZ0123", seconds: 3_600),
        ];
        Assert.Equal(new FlightMatch("p:in", "Callsign"), Only(Match([Plane("0c0001", callsign: "ZZA123")], sameNumber)));
    }

    [Fact]
    public void OneAircraftPerFlightAndOneFlightPerAircraft()
    {
        // A registration beats a callsign, even a fresher one; the other aircraft stays without a flight.
        var matches = Match(
            [Plane("0c0002", callsign: "ZZA123", secondsAgo: 1), Plane("0c0001", registration: "ZZABC", secondsAgo: 30)],
            [Flight("p:1", number: "ZZ0123", registration: "ZZ-ABC")]);
        Assert.Equal(new FlightMatch("p:1", "Registration"), Only(matches));

        // Two callsigns: the freshest position wins.
        matches = Match(
            [Plane("0c0003", callsign: "ZZA123", secondsAgo: 20), Plane("0c0001", callsign: "ZZA0123", secondsAgo: 2)],
            [Flight("p:2", number: "ZZ0123")]);
        Assert.Equal(new FlightMatch("p:2", "Callsign"), Only(matches));

        // Two flights and two aircraft: each aircraft its own flight, never both.
        matches = Match(
            [Plane("0c0005", callsign: "ZZA123"), Plane("0c0006", callsign: "ZZA456")],
            [Flight("p:a", number: "ZZ0123", seconds: 600), Flight("p:b", number: "ZZ0456", seconds: 1_200)]);
        Assert.Equal(2, matches.Count);
        Assert.Equal((new FlightMatch("p:a", "Callsign"), new FlightMatch("p:b", "Callsign")),
            (matches["0c0005"], matches["0c0006"]));

        // An address listed twice is one aircraft, at its freshest position.
        matches = Match(
            [Plane("0c0001", callsign: "YYB1", secondsAgo: 5), Plane("0c0001", callsign: "ZZA123", secondsAgo: 1)],
            [Flight("p:3", number: "ZZ0123")]);
        Assert.Equal(new FlightMatch("p:3", "Callsign"), Only(matches));
    }

    private static IReadOnlyDictionary<string, FlightMatch> Match(IReadOnlyList<AirTrafficAircraft> aircraft,
        IReadOnlyList<MapFlightMatchKey> flights) => FlightAircraftMatcher.Match(aircraft, flights, Now);

    /// <summary>The one match, which belongs to the aircraft 0c0001.</summary>
    private static FlightMatch Only(IReadOnlyDictionary<string, FlightMatch> matches)
    {
        var match = Assert.Single(matches);
        Assert.Equal("0c0001", match.Key);
        return match.Value;
    }

    /// <summary>A synthetic aircraft near Punta Cana.</summary>
    private static AirTrafficAircraft Plane(string hex, string? callsign = null, string? registration = null, int secondsAgo = 0) =>
        new(hex, callsign, registration, "B738", "A3", 18.62, -68.51, 4200, false, 210, 75, -900, null,
            Now.AddSeconds(-secondsAgo));

    /// <summary>A synthetic flight of the airline ZZA / ZZ, <paramref name="seconds"/> from now.</summary>
    private static MapFlightMatchKey Flight(string key, string direction = "Arrival", string number = "ZZ123",
        string? registration = null, int seconds = 0, bool happened = false, bool demo = false, string? iata = "ZZ") =>
        new(key, direction, number, "ZZA", iata, registration, Now.AddSeconds(seconds), happened, demo);
}
