using Elevant.Application.Abstractions.Integrations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure;
using Elevant.Infrastructure.Integrations.AeroDataBox;
using Elevant.Infrastructure.Integrations.SimulatedFlightFeed;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>2-B: the simulated flight feed is deterministic, opt-in, Development or Test only and never next to AeroDataBox.</summary>
public sealed class SimulatedAirportFlightFeedTests
{
    private static readonly TimeZoneInfo Zone = TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo");

    private static readonly FeedAirline[] Airlines =
    [
        new("Demo Airlines", "ZZ", "DZZ"),
        new("Charter Air", null, "CQZ"),
    ];

    [Fact]
    public void SameInputsGiveTheSameTimetableInsideTheWindow()
    {
        var from = new DateTime(2026, 11, 6, 6, 0, 0);
        var to = from.AddHours(12);
        var first = SimulatedAirportFlightFeed.Generate("PUJ", Zone, from, to, Airlines);
        var second = SimulatedAirportFlightFeed.Generate("PUJ", Zone, from, to, Airlines);

        Assert.Equal(first, second);
        Assert.NotEmpty(first);
        Assert.All(first, flight =>
        {
            var local = TimeZoneInfo.ConvertTime(flight.ScheduledUtc, Zone).DateTime;
            Assert.InRange(local, from, to);
            Assert.NotNull(flight.AircraftModel);
            Assert.NotNull(flight.Registration);
            Assert.NotEqual("PUJ", flight.Counterpart!.IataCode);
            Assert.False(flight.IsCargo);
        });
        // Demo Airlines (rank 0) lands at 09:00 and leaves 75 minutes later with the same aircraft.
        var arrival = Assert.Single(first, flight => flight.Number == "ZZ102");
        var departure = Assert.Single(first, flight => flight.Number == "ZZ103");
        Assert.Equal((FlightDirection.Arrival, FlightDirection.Departure), (arrival.Direction, departure.Direction));
        Assert.Equal(new DateTimeOffset(2026, 11, 6, 13, 0, 0, TimeSpan.Zero), arrival.ScheduledUtc);
        Assert.Equal(arrival.ScheduledUtc.AddMinutes(SimulatedAirportFlightFeed.TurnMinutes), departure.ScheduledUtc);
        Assert.Equal(arrival.Registration, departure.Registration);
        Assert.Equal(arrival.Counterpart, departure.Counterpart);
        // An operator without IATA code flies under its ICAO code, staggered after the first airline.
        Assert.Contains(first, flight => flight.Number == "CQZ102" &&
            flight.ScheduledUtc == arrival.ScheduledUtc.AddMinutes(25));
    }

    [Fact]
    public void AnAirportWithoutStationAnswersNoContentAndAWrongWindowIsRefused()
    {
        var feed = new SimulatedAirportFlightFeed(new FakeCatalog(null));
        var from = new DateTime(2026, 11, 6, 6, 0, 0);

        var none = feed.GetFlightsAsync("PUJ", from, from.AddHours(12)).GetAwaiter().GetResult();
        Assert.Equal((ProviderCallOutcome.NoContent, 2, 0), (none.Outcome, none.Units, none.Flights.Count));
        Assert.Equal(("Simulated", true), (feed.Provider, feed.IsConfigured));
        Assert.Throws<ArgumentException>(() => feed.GetFlightsAsync("PUJ", from, from.AddHours(13)).GetAwaiter().GetResult());
        Assert.Throws<ArgumentException>(() => feed.GetFlightsAsync("PUNTA", from, from.AddHours(1)).GetAwaiter().GetResult());
    }

    [Fact]
    public async Task TheStationTimetableComesFromTheCatalog()
    {
        var feed = new SimulatedAirportFlightFeed(new FakeCatalog(new SimulatedFeedScope("America/Santo_Domingo", Airlines)));
        var from = new DateTime(2026, 11, 6, 6, 0, 0);

        var answer = await feed.GetFlightsAsync("puj", from, from.AddHours(12));

        Assert.Equal((ProviderCallOutcome.Succeeded, 2, 200), (answer.Outcome, answer.Units, answer.HttpStatus));
        Assert.Equal(SimulatedAirportFlightFeed.Generate("PUJ", Zone, from, from.AddHours(12), Airlines), answer.Flights);
    }

    [Theory]
    [InlineData("Development", null, true)]
    [InlineData("Test", null, true)]
    [InlineData("Production", null, false)]
    [InlineData("Staging", null, false)]
    [InlineData("Development", "true", false)]
    public void TheSimulatedFeedIsOnlyComposedInDevelopmentOrTestWithoutAeroDataBox(string environment, string? aeroDataBox,
        bool composes)
    {
        var settings = new Dictionary<string, string?>
        {
            ["DOTNET_ENVIRONMENT"] = environment,
            ["SimulatedFlightFeed:Enabled"] = "true",
            ["AeroDataBox:Enabled"] = aeroDataBox,
        };
        var services = new ServiceCollection().AddSingleton<ISimulatedFlightFeedCatalog>(new FakeCatalog(null));
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

        if (!composes)
        {
            Assert.Throws<InvalidOperationException>(() => services.AddInfrastructure(configuration));
            return;
        }
        var feed = Assert.Single(services.AddInfrastructure(configuration), item => item.ServiceType == typeof(IAirportFlightFeed));
        Assert.Equal(typeof(SimulatedAirportFlightFeed), feed.ImplementationType);
        Assert.Equal(ServiceLifetime.Singleton, feed.Lifetime);
    }

    [Fact]
    public void WithoutConfigurationTheFeedStaysOff()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["DOTNET_ENVIRONMENT"] = "Development",
        }).Build();

        var feed = Assert.Single(new ServiceCollection().AddInfrastructure(configuration),
            item => item.ServiceType == typeof(IAirportFlightFeed));

        Assert.Equal(typeof(DisabledAirportFlightFeed), feed.ImplementationType);
        Assert.False(new DisabledAirportFlightFeed().IsConfigured);
    }

    private sealed class FakeCatalog(SimulatedFeedScope? scope) : ISimulatedFlightFeedCatalog
    {
        public Task<SimulatedFeedScope?> FindAsync(string airportIataCode, CancellationToken cancellationToken = default) =>
            Task.FromResult(airportIataCode == "PUJ" ? scope : null);
    }
}
