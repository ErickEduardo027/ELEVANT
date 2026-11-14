using Elevant.Application.Operations.MapFlights;

namespace Elevant.UnitTests.Application;

/// <summary>
/// ADR-0042 (contracts 1.3): the phase of a map flight is one closed list of words. An actual time decides first; without
/// one, the provider's text does, in any case.
/// </summary>
public sealed class MapFlightPhasesTests
{
    private static readonly DateTimeOffset Scheduled = new(2026, 11, 13, 16, 0, 0, TimeSpan.Zero);

    [Fact]
    public void ThePhasesAreTheContractsList() =>
        Assert.Equal(["scheduled", "departed", "enroute", "approaching", "landed", "arrived", "cancelled", "diverted", "unknown"],
            MapFlightPhases.All);

    [Theory]
    [InlineData("Expected", MapFlightPhases.Scheduled)]
    [InlineData("Unknown", MapFlightPhases.Scheduled)]
    [InlineData("CheckIn", MapFlightPhases.Scheduled)]
    [InlineData("Boarding", MapFlightPhases.Scheduled)]
    [InlineData("GateClosed", MapFlightPhases.Scheduled)]
    [InlineData("Delayed", MapFlightPhases.Scheduled)]
    [InlineData("Departed", MapFlightPhases.Departed)]
    [InlineData("EnRoute", MapFlightPhases.EnRoute)]
    [InlineData("Approaching", MapFlightPhases.Approaching)]
    [InlineData("Arrived", MapFlightPhases.Arrived)]
    [InlineData("Canceled", MapFlightPhases.Cancelled)]
    [InlineData("Cancelled", MapFlightPhases.Cancelled)]
    [InlineData("CanceledUncertain", MapFlightPhases.Cancelled)]
    [InlineData("Diverted", MapFlightPhases.Diverted)]
    [InlineData("Landed", MapFlightPhases.Unknown)]
    [InlineData("En Route", MapFlightPhases.Unknown)]
    [InlineData("Something else", MapFlightPhases.Unknown)]
    public void EveryProviderTextMapsToItsPhase(string text, string phase)
    {
        // Before the flight's time, in any case and with spaces around it, for both directions.
        foreach (var written in new[] { text, text.ToUpperInvariant(), text.ToLowerInvariant(), $"  {text} " })
        foreach (var direction in new[] { "Arrival", "Departure", "arrival", "DEPARTURE" })
            Assert.Equal(phase, MapFlightPhases.Of(direction, written, Scheduled, null, null, null, Scheduled.AddMinutes(-30)));
    }

    [Fact]
    public void ARunwayTimeOverridesTheText()
    {
        var actual = Scheduled.AddMinutes(4);
        foreach (var text in new[] { "Expected", "Approaching", "Arrived", "Departed", "Canceled", "Diverted", "Landed", null })
        {
            // The wheels on the runway: the arrival landed, the departure left.
            Assert.Equal(MapFlightPhases.Landed, MapFlightPhases.Of("Arrival", text, Scheduled, null, actual,
                MapFlightActualKinds.Runway, actual));
            Assert.Equal(MapFlightPhases.Departed, MapFlightPhases.Of("Departure", text, Scheduled, null, actual,
                MapFlightActualKinds.Runway, actual));
            // The time OCC recorded is the aircraft on its stand: the arrival is there, the departure is gone.
            Assert.Equal(MapFlightPhases.Arrived, MapFlightPhases.Of("Arrival", text, Scheduled, null, actual,
                MapFlightActualKinds.OnBlock, actual));
            Assert.Equal(MapFlightPhases.Departed, MapFlightPhases.Of("Departure", text, Scheduled, null, actual,
                MapFlightActualKinds.OnBlock, actual));
        }

        // Without an actual time the kind says nothing: the text decides.
        Assert.Equal(MapFlightPhases.Approaching, MapFlightPhases.Of("Arrival", "Approaching", Scheduled, null, null,
            MapFlightActualKinds.Runway, Scheduled));
        Assert.Equal(MapFlightPhases.Cancelled, MapFlightPhases.Of("Departure", "Canceled", Scheduled, null, null,
            MapFlightActualKinds.OnBlock, Scheduled));
    }

    [Fact]
    public void AnArrivalBecomesEnRouteWhenItsTimeComes()
    {
        // An arrival the provider still expects is scheduled until its time, and en route from then on.
        Assert.Equal(MapFlightPhases.Scheduled, MapFlightPhases.Of("Arrival", "Expected", Scheduled, null, null, null,
            Scheduled.AddTicks(-1)));
        Assert.Equal(MapFlightPhases.EnRoute, MapFlightPhases.Of("Arrival", "Expected", Scheduled, null, null, null, Scheduled));
        Assert.Equal(MapFlightPhases.EnRoute, MapFlightPhases.Of("Arrival", "boarding", Scheduled, null, null, null,
            Scheduled.AddHours(2)));

        // Its estimate is its time when it has one.
        var estimated = Scheduled.AddMinutes(40);
        Assert.Equal(MapFlightPhases.Scheduled, MapFlightPhases.Of("Arrival", "Delayed", Scheduled, estimated, null, null,
            Scheduled.AddMinutes(10)));
        Assert.Equal(MapFlightPhases.EnRoute, MapFlightPhases.Of("Arrival", "Delayed", Scheduled, estimated, null, null,
            estimated));
        Assert.Equal(MapFlightPhases.EnRoute, MapFlightPhases.Of("Arrival", "Expected", Scheduled, Scheduled.AddMinutes(-15),
            null, null, Scheduled.AddMinutes(-10)));

        // A leg OCC typed has no provider text: it reads as Unknown.
        foreach (var text in new[] { null, "", "   " })
        {
            Assert.Equal(MapFlightPhases.Scheduled, MapFlightPhases.Of("Arrival", text, Scheduled, null, null, null,
                Scheduled.AddMinutes(-1)));
            Assert.Equal(MapFlightPhases.EnRoute, MapFlightPhases.Of("Arrival", text, Scheduled, null, null, null,
                Scheduled.AddMinutes(1)));
        }

        // A departure waits at its stand: scheduled however late it is.
        foreach (var text in new[] { "Expected", "GateClosed", null })
            Assert.Equal(MapFlightPhases.Scheduled, MapFlightPhases.Of("Departure", text, Scheduled, null, null, null,
                Scheduled.AddHours(3)));
    }

    [Fact]
    public void ALegIsAnArrivalOrADeparture() =>
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            MapFlightPhases.Of("Overflight", "Expected", Scheduled, null, null, null, Scheduled));
}
