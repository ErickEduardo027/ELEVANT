using Elevant.Application.Integration.DemoFlights;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0041: a demo flight's numbers and registration are generated, never typed, so the import can never link the
/// demo pair to a flight OCC already planned that day (3-N07) nor match a real aircraft.
/// </summary>
public sealed class DemoFlightNumberingTests
{
    private static HashSet<string> Used(params string[] numbers) => new(numbers, StringComparer.Ordinal);

    [Fact]
    public void PicksTheFirstFreeOddEvenPairFrom9001()
    {
        var pair = DemoFlightNumbering.NextPair("ZZ", Used());

        Assert.NotNull(pair);
        Assert.Equal(("ZZ9001", "ZZ9002"), pair.Value);
        Assert.True(FlightIdentity.IsFlightNumber(pair.Value.Arrival));
        Assert.True(FlightIdentity.IsFlightNumber(pair.Value.Departure));
    }

    [Fact]
    public void SkipsNumbersAlreadyKnownThatDay()
    {
        // 9001 is a proposal of the day and 9004 the departure of a planned turnaround: neither pair is free.
        Assert.Equal(("ZZ9005", "ZZ9006"), DemoFlightNumbering.NextPair("ZZ", Used("ZZ9001", "ZZ9004")));
        // An even number alone blocks its pair too, and the code is written as flight numbers are.
        Assert.Equal(("ZZ9003", "ZZ9004"), DemoFlightNumbering.NextPair(" zz ", Used("ZZ9002")));
        // Another airline's flights do not count.
        Assert.Equal(("ZZ9001", "ZZ9002"), DemoFlightNumbering.NextPair("ZZ", Used("AA9001", "AA9002")));

        // The last pair of the day is 9997 and 9998; after it there is no number left.
        var arrivals = Enumerable.Range(0, 499).Select(index => $"ZZ{9001 + 2 * index}").ToArray();
        Assert.Equal("ZZ9997", arrivals[^1]);
        Assert.Equal(("ZZ9997", "ZZ9998"), DemoFlightNumbering.NextPair("ZZ", Used(arrivals[..^1])));
        Assert.Null(DemoFlightNumbering.NextPair("ZZ", Used(arrivals)));
    }

    [Fact]
    public void UsesTheIcaoCodeWhenTheAirlineHasNoIata()
    {
        Assert.Equal("ZZ", DemoFlightNumbering.AirlineCode("ZZ", "DZZ"));
        Assert.Equal("CQZ", DemoFlightNumbering.AirlineCode(null, "CQZ"));
        Assert.Equal("CQZ", DemoFlightNumbering.AirlineCode("  ", "cqz"));
        Assert.Equal(("CQZ9001", "CQZ9002"),
            DemoFlightNumbering.NextPair(DemoFlightNumbering.AirlineCode(null, "CQZ"), Used()));
    }

    [Fact]
    public void RegistrationIsHidmAndTwoDigits()
    {
        Assert.Equal("HIDM01", DemoFlightNumbering.Registration(1));
        Assert.Equal("HIDM09", DemoFlightNumbering.Registration(9));
        Assert.Equal("HIDM10", DemoFlightNumbering.Registration(10));
        Assert.Equal("HIDM99", DemoFlightNumbering.Registration(99));
        // The hundredth flight of the day has no registration left.
        Assert.Null(DemoFlightNumbering.Registration(100));
        Assert.Null(DemoFlightNumbering.Registration(0));
        Assert.Null(DemoFlightNumbering.Registration(-1));

        // Every one is distinct and passes the rule the tablet applies to the registration it shows.
        var registrations = Enumerable.Range(1, 99).Select(DemoFlightNumbering.Registration).ToArray();
        Assert.Equal(99, registrations.Distinct(StringComparer.Ordinal).Count());
        Assert.All(registrations, registration =>
        {
            Assert.NotNull(registration);
            Assert.True(RampExecutionPolicy.IsValidRegistration(registration));
        });
    }

    [Fact]
    public void ReferenceRoundTripsTheDemoId()
    {
        var demoId = Guid.Parse("0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a");

        Assert.Equal("0193a6f25c1e7d3a9b441f2e3d4c5b6a|Arrival",
            DemoFlightNumbering.Reference(demoId, FlightDirection.Arrival));
        Assert.Equal("0193a6f25c1e7d3a9b441f2e3d4c5b6a|Departure",
            DemoFlightNumbering.Reference(demoId, FlightDirection.Departure));
        Assert.Equal(demoId, DemoFlightNumbering.DemoIdOf("0193a6f25c1e7d3a9b441f2e3d4c5b6a|Arrival"));
        Assert.Equal(demoId, DemoFlightNumbering.DemoIdOf("0193a6f25c1e7d3a9b441f2e3d4c5b6a|Departure"));

        // Only what Reference writes is a demo reference.
        string?[] others =
        [
            null, "", "ZZ102|Arrival|2026-11-06T13:00:00Z", "0193a6f25c1e7d3a9b441f2e3d4c5b6a",
            "0193a6f25c1e7d3a9b441f2e3d4c5b6a|", "0193a6f25c1e7d3a9b441f2e3d4c5b6a|arrival",
            "0193a6f25c1e7d3a9b441f2e3d4c5b6a|Arrival|x", "0193a6f25c1e7d3a9b441f2e3d4c5b6a|1",
            "0193a6f2-5c1e-7d3a-9b44-1f2e3d4c5b6a|Arrival", "0193a6f25c1e7d3a9b441f2e3d4c5b6|Arrival",
            "00000000000000000000000000000000|Arrival",
        ];
        Assert.All(others, reference => Assert.Null(DemoFlightNumbering.DemoIdOf(reference)));
    }
}
