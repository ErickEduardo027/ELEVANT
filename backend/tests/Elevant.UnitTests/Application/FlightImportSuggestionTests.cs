using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// CN-28: the import of the provider's flights preselects the aircraft type (live aircraft, provider's model, history)
/// and the stand (the airport's gate, else a free stand of the terminal) with their sources. Every registration,
/// callsign and code here is invented.
/// </summary>
public sealed class FlightImportSuggestionTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 24, 19, 0, 0, TimeSpan.Zero);
    private static readonly AircraftTypeCandidate B738 = new(Guid.NewGuid(), "B738", "Boeing", "737-800", AircraftSizeCategory.Narrowbody);
    private static readonly AircraftTypeCandidate B38M = new(Guid.NewGuid(), "B38M", "Boeing", "737 MAX 8", AircraftSizeCategory.Narrowbody);
    private static readonly AircraftTypeCandidate B789 = new(Guid.NewGuid(), "B789", "Boeing", "787-9", AircraftSizeCategory.Widebody);
    private static readonly AircraftTypeCandidate A320 = new(Guid.NewGuid(), "A320", "Airbus", "A320", AircraftSizeCategory.Narrowbody);
    private static readonly AircraftTypeCandidate A20N = new(Guid.NewGuid(), "A20N", "Airbus", "A320neo", AircraftSizeCategory.Narrowbody);
    private static readonly AircraftTypeCandidate A321 = new(Guid.NewGuid(), "A321", "Airbus", "A321", AircraftSizeCategory.Narrowbody);
    private static readonly AircraftTypeCandidate[] Types = [B738, B38M, B789, A320, A20N, A321];

    [Fact]
    public void TheLiveAircraftTypeComesFirst()
    {
        // The aircraft broadcasts B38M while the provider says «Boeing 737-800»: what flies wins.
        Assert.Equal(new AircraftTypeSuggestion(B38M.Id, AircraftTypeSuggestionSources.Live),
            AircraftTypeSuggester.Suggest(" b38m ", "Boeing 737-800", Types, null));
        // A designator outside the catalog falls back to the provider's model, then to nothing.
        Assert.Equal(new AircraftTypeSuggestion(B738.Id, AircraftTypeSuggestionSources.ProviderModel),
            AircraftTypeSuggester.Suggest("B739", "Boeing 737-800", Types, null));
        Assert.Null(AircraftTypeSuggester.Suggest("B739", null, Types, null));
    }

    [Fact]
    public void AGenericModelTakesTheTypeTheAirlineFliesMostOfThatFamily()
    {
        // «Boeing 737» names no type: the airline flew B738 7 times of 9 in the family (78 %).
        var history = new Dictionary<Guid, int> { [B738.Id] = 7, [B38M.Id] = 2, [A320.Id] = 40 };
        Assert.Equal(new AircraftTypeSuggestion(B738.Id, AircraftTypeSuggestionSources.History),
            AircraftTypeSuggester.Suggest(null, "Boeing 737", Types, history));
        // «Airbus A320 family» counts A320, A320neo and A321.
        var airbus = new Dictionary<Guid, int> { [A20N.Id] = 8, [A321.Id] = 2, [B738.Id] = 30 };
        Assert.Equal(new AircraftTypeSuggestion(A20N.Id, AircraftTypeSuggestionSources.History),
            AircraftTypeSuggester.Suggest(null, "Airbus A320 family", Types, airbus));
    }

    [Fact]
    public void AnAmbiguousOrThinHistorySuggestsNothing()
    {
        // 5 of 9 is 56 %: under the 60 % a suggestion needs.
        Assert.Null(AircraftTypeSuggester.Suggest(null, "Boeing 737",
            Types, new Dictionary<Guid, int> { [B738.Id] = 5, [B38M.Id] = 4 }));
        // Two flights are not a history.
        Assert.Null(AircraftTypeSuggester.Suggest(null, "Boeing 737", Types, new Dictionary<Guid, int> { [B738.Id] = 2 }));
        // Flights of another family never count.
        Assert.Null(AircraftTypeSuggester.Suggest(null, "Boeing 737", Types, new Dictionary<Guid, int> { [A320.Id] = 50 }));
        Assert.Null(AircraftTypeSuggester.Suggest(null, "Boeing 737", Types, null));
    }

    [Fact]
    public void OnlyAGenericTextIsAFamily()
    {
        Assert.Equal([B738.Id, B38M.Id], AircraftModelMatcher.Family("Boeing 737", Types));
        Assert.Equal([B738.Id, B38M.Id], AircraftModelMatcher.Family("737 series", Types));
        Assert.Equal([A320.Id, A20N.Id, A321.Id], AircraftModelMatcher.Family("Airbus A320 Family", Types));
        Assert.Equal([A320.Id, A20N.Id], AircraftModelMatcher.Family("Airbus A320", Types));
        // A variant is no family, nor a text without a family's number.
        Assert.Empty(AircraftModelMatcher.Family("Boeing 737-800", Types));
        Assert.Empty(AircraftModelMatcher.Family("Boeing 737 MAX 8", Types));
        Assert.Empty(AircraftModelMatcher.Family("Boeing", Types));
        Assert.Empty(AircraftModelMatcher.Family(null, Types));
        // The manufacturer the text names is respected.
        Assert.Empty(AircraftModelMatcher.Family("Airbus 737", Types));
    }

    [Fact]
    public void TheLiveAircraftOfAFlightIsFoundByItsIcaoCallsign()
    {
        MapFlightMatchKey[] flights =
        [
            new("arrival", "Arrival", "ZZ893", "ZZA", "ZZ", null, Now.AddMinutes(40), false, false),
            new("demo", "Arrival", "ZZ9001", "ZZA", "ZZ", null, Now.AddMinutes(10), false, true),
        ];
        AirTrafficAircraft[] aircraft =
        [
            Plane("0c0001", "ZZA893", "ZZ-1849", "B38M", Now.AddSeconds(-30)),
            Plane("0c0001", "ZZA893", "ZZ-1849", "B38M", Now.AddSeconds(-5)),
            Plane("0c0002", "ZZA9001", "ZZ-0001", "A320", Now),
        ];

        var byFlight = FlightAircraftMatcher.AircraftByFlight(aircraft, flights, Now);

        var plane = Assert.Single(byFlight).Value;
        Assert.Equal(("ZZ-1849", "B38M", Now.AddSeconds(-5)), (plane.Registration, plane.TypeIcaoCode, plane.PositionAt));
        Assert.Equal("arrival", byFlight.Single().Key);
    }

    [Fact]
    public void AGateIsTheStandOfItsTerminalByItsNormalizedCode()
    {
        Assert.Equal(["B20", "20"], ProposalStandSuggester.GateCodes("20", "B"));
        Assert.Equal(["B20", "20"], ProposalStandSuggester.GateCodes("020", "Terminal B"));
        Assert.Equal(["B9A", "9A"], ProposalStandSuggester.GateCodes("9A", "B"));
        Assert.Equal(["B20"], ProposalStandSuggester.GateCodes("B-020", "B"));
        Assert.Equal(["A5"], ProposalStandSuggester.GateCodes("A05", null));
        Assert.Equal(["20"], ProposalStandSuggester.GateCodes("20", null));
        // A terminal named by digits never prefixes a number.
        Assert.Equal(["20"], ProposalStandSuggester.GateCodes("20", "2"));
        Assert.Empty(ProposalStandSuggester.GateCodes(" ", "B"));
    }

    [Fact]
    public void TheGateOfARealOrDemoFlightIsItsStandWhenFree()
    {
        var b20 = Stand(1, "B20", "B");
        StandOption[] stands = [Stand(2, "A01", "A"), b20, Stand(3, "B21", "B")];

        // A real flight: gate «20» in terminal B. A demo flight: its gate is its stand's code.
        var suggested = ProposalStandSuggester.Suggest(stands, [], [],
        [
            Request("real", "20", "B", Now, Now.AddHours(1)),
            Request("demo", "A1", "A", Now, Now.AddHours(1)),
        ]);

        Assert.Equal(new StandSuggestion(b20.PublicId, StandSuggestionSources.Gate), suggested["real"]);
        Assert.Equal(new StandSuggestion(stands[0].PublicId, StandSuggestionSources.Gate), suggested["demo"]);
    }

    [Fact]
    public void AGateHeldByAnotherFlightFallsBackToAFreeStandOfTheTerminal()
    {
        var b20 = Stand(1, "B20", "B");
        var b3 = Stand(3, "B3", "B");
        var b10 = Stand(2, "B10", "B");
        StandOption[] stands = [b20, b10, b3, Stand(4, "A1", "A")];
        HeldStand[] held = [new(b20.Id, b20.Code, AircraftSizeCategory.Narrowbody, Now.AddMinutes(-30), Now.AddMinutes(30))];

        var suggested = ProposalStandSuggester.Suggest(stands, held, [],
            [Request("arrival", "20", "B", Now, Now.AddHours(1))]);

        // B3 before B10: the natural order of the codes.
        Assert.Equal(new StandSuggestion(b3.PublicId, StandSuggestionSources.Free), suggested["arrival"]);

        // Once the other flight left, the gate is free again.
        var later = ProposalStandSuggester.Suggest(stands, held, [],
            [Request("arrival", "20", "B", Now.AddMinutes(30), Now.AddHours(2))]);
        Assert.Equal(StandSuggestionSources.Gate, later["arrival"].Source);
    }

    [Fact]
    public void AFreeStandFitsTheAircraftAndIsNeverSuggestedTwice()
    {
        var narrow = Stand(1, "B1", "B", AircraftSizeCategory.Narrowbody);
        var wide = Stand(2, "B2", "B", AircraftSizeCategory.Widebody);
        var any = Stand(3, "B3", "B");
        StandOption[] stands = [narrow, wide, any];

        var suggested = ProposalStandSuggester.Suggest(stands, [], [],
        [
            Request("wide", null, "B", Now, Now.AddHours(2), AircraftSizeCategory.Widebody),
            Request("narrow-1", null, "B", Now.AddMinutes(5), Now.AddHours(1), AircraftSizeCategory.Narrowbody),
            Request("narrow-2", null, "B", Now.AddMinutes(10), Now.AddHours(1), AircraftSizeCategory.Narrowbody),
            Request("narrow-3", null, "B", Now.AddMinutes(15), Now.AddHours(1), AircraftSizeCategory.Narrowbody),
            // Another terminal, or one the station does not have: nothing there.
            Request("elsewhere", null, "Z", Now, Now.AddHours(1)),
        ]);

        // The wide-body takes the wide-body stand; the narrow-bodies the narrow-body one first, then what is left.
        Assert.Equal(wide.PublicId, suggested["wide"].StandId);
        Assert.Equal(narrow.PublicId, suggested["narrow-1"].StandId);
        Assert.Equal(any.PublicId, suggested["narrow-2"].StandId);
        Assert.False(suggested.ContainsKey("narrow-3"));
        Assert.False(suggested.ContainsKey("elsewhere"));
        Assert.All(suggested.Values, item => Assert.Equal(StandSuggestionSources.Free, item.Source));
    }

    [Fact]
    public void CombinedStandRulesAreRespected()
    {
        var s10 = Stand(1, "10", "B");
        var s9A = Stand(2, "9A", "B");
        var s25 = Stand(3, "25", "B");
        var s23A = Stand(4, "23A", "B");
        StandOption[] stands = [s10, s9A, s25, s23A];
        StandRule[] rules =
        [
            new(s9A.Id, s10.Id, StandConstraintKind.Cancels),
            new(s23A.Id, s25.Id, StandConstraintKind.NarrowbodyOnly),
        ];
        // 9A and 23A are held: 10 is cancelled and 25 takes only narrow-bodies.
        HeldStand[] held =
        [
            new(s9A.Id, s9A.Code, AircraftSizeCategory.Narrowbody, null, null),
            new(s23A.Id, s23A.Code, AircraftSizeCategory.Narrowbody, Now.AddHours(-1), Now.AddHours(3)),
        ];

        var suggested = ProposalStandSuggester.Suggest(stands, held, rules,
        [
            Request("gate-10", "10", "B", Now, Now.AddHours(1)),
            Request("wide", null, "B", Now, Now.AddHours(1), AircraftSizeCategory.Widebody),
        ]);

        // The gate 10 is cancelled: the only stand left for it is 25.
        Assert.Equal(new StandSuggestion(s25.PublicId, StandSuggestionSources.Free), suggested["gate-10"]);
        // No stand takes the wide-body.
        Assert.False(suggested.ContainsKey("wide"));
    }

    private static StandOption Stand(long id, string code, string terminal, AircraftSizeCategory? max = null) =>
        new(id, Guid.NewGuid(), code, terminal, max);

    private static StandRequest Request(string key, string? gate, string? terminal, DateTimeOffset start, DateTimeOffset end,
        AircraftSizeCategory? size = AircraftSizeCategory.Narrowbody) => new(key, gate, terminal, size, start, end);

    private static AirTrafficAircraft Plane(string hex, string callsign, string registration, string type, DateTimeOffset at) =>
        new(hex, callsign, registration, type, "A3", 18.4, -69.6, 9000, false, 250, 90, -800, null, at);
}
