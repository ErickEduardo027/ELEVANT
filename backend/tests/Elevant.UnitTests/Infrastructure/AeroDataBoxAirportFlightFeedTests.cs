using System.Net;
using System.Text;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Integrations.AeroDataBox;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>ADR-0028: the AeroDataBox FIDS adapter, against a synthetic document (never the live API).</summary>
public sealed class AeroDataBoxAirportFlightFeedTests
{
    // Synthetic FIDS answer shaped like the direct API contract (AirportFidsContract).
    private const string Fids = """
        {
          "arrivals": [
            {
              "departure": { "airport": { "icao": "MDSD", "iata": "SDQ", "name": "Santo Domingo Las Americas",
                  "municipalityName": "Santo Domingo", "countryCode": "DO", "timeZone": "America/Santo_Domingo",
                  "location": { "lat": 18.4297, "lon": -69.6689 } }, "quality": [] },
              "arrival": { "airport": { "icao": "MDPC", "iata": "PUJ", "name": "Punta Cana" },
                  "scheduledTime": { "utc": "2026-11-03 14:05Z", "local": "2026-11-03 10:05-04:00" },
                  "revisedTime": { "utc": "2026-11-03 14:20Z", "local": "2026-11-03 10:20-04:00" },
                  "terminal": "B", "gate": "22", "quality": ["Basic", "Live"] },
              "number": "ZZ 161", "status": "Expected", "codeshareStatus": "IsOperator", "isCargo": false,
              "aircraft": { "reg": "hi1055", "model": "Boeing 737 MAX 8" },
              "airline": { "name": "Demo Airlines", "iata": "ZZ", "icao": "ZZA" }
            },
            {
              "movement": { "airport": { "iata": "MIA", "name": "Miami" }, "quality": [] },
              "number": "AA 1", "status": "Unknown", "codeshareStatus": "IsOperator", "isCargo": false
            }
          ],
          "departures": [
            {
              "movement": { "airport": { "icao": "KJFK", "iata": "JFK", "name": "New York JFK", "countryCode": "US" },
                  "scheduledTime": { "utc": "2026-11-03 15:30Z", "local": "2026-11-03 11:30-04:00" },
                  "runwayTime": { "utc": "2026-11-03 15:41Z", "local": "2026-11-03 11:41-04:00" }, "quality": ["Live"] },
              "number": "ZZ162", "status": "Departed", "codeshareStatus": "IsOperator", "isCargo": false,
              "airline": { "name": "Demo Airlines", "iata": "ZZ" }
            }
          ]
        }
        """;

    private static AeroDataBoxAirportFlightFeed Feed(StubHandler handler, bool enabled = true, string? key = "synthetic-key") =>
        new(new HttpClient(handler), new AeroDataBoxOptions { Enabled = enabled, ApiKey = key });

    [Fact]
    public async Task ReadsArrivalsAndDeparturesInOneCallWithTheLeanestQuery()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StringContent(Fids, Encoding.UTF8, "application/json") });
        var response = await Feed(handler).GetFlightsAsync("puj", new DateTime(2026, 11, 3, 8, 0, 0), new DateTime(2026, 11, 3, 20, 0, 0));

        Assert.Equal((ProviderCallOutcome.Succeeded, 2, 200), (response.Outcome, response.Units, response.HttpStatus));
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://api.aerodatabox.com/flights/airports/iata/PUJ/2026-11-03T08:00/2026-11-03T20:00" +
            "?direction=Both&withLeg=true&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false",
            request.Uri);
        Assert.Equal("synthetic-key", request.ApiKey);

        // The arrival without a scheduled time is skipped.
        Assert.Equal(2, response.Flights.Count);
        var arrival = response.Flights[0];
        Assert.Equal((FlightDirection.Arrival, "ZZ161", "HI1055", "B", "22"),
            (arrival.Direction, arrival.Number, arrival.Registration, arrival.Terminal, arrival.Gate));
        Assert.Equal(new DateTimeOffset(2026, 11, 3, 14, 5, 0, TimeSpan.Zero), arrival.ScheduledUtc);
        Assert.Equal(new DateTimeOffset(2026, 11, 3, 14, 20, 0, TimeSpan.Zero), arrival.RevisedUtc);
        Assert.Equal(("Demo Airlines", "ZZ", "ZZA"), (arrival.Airline!.Name, arrival.Airline.IataCode, arrival.Airline.IcaoCode));
        Assert.Equal(("SDQ", "MDSD", "DO", "America/Santo_Domingo", 18.4297m),
            (arrival.Counterpart!.IataCode, arrival.Counterpart.IcaoCode, arrival.Counterpart.CountryCode,
                arrival.Counterpart.TimeZone, arrival.Counterpart.Latitude));
        var departure = response.Flights[1];
        Assert.Equal((FlightDirection.Departure, "ZZ162", "JFK", "Departed"),
            (departure.Direction, departure.Number, departure.Counterpart!.IataCode, departure.Status));
        Assert.Equal(new DateTimeOffset(2026, 11, 3, 15, 41, 0, TimeSpan.Zero), departure.RunwayUtc);
        Assert.Null(departure.Airline!.IcaoCode);
    }

    [Theory]
    [InlineData(HttpStatusCode.NoContent, "", ProviderCallOutcome.NoContent, 2)]
    [InlineData(HttpStatusCode.Unauthorized, "", ProviderCallOutcome.Unauthorized, 0)]
    [InlineData(HttpStatusCode.Forbidden, "Invalid key", ProviderCallOutcome.Unauthorized, 0)]
    [InlineData(HttpStatusCode.TooManyRequests, "Too many requests", ProviderCallOutcome.RateLimited, 0)]
    [InlineData(HttpStatusCode.TooManyRequests, "Monthly quota exceeded", ProviderCallOutcome.QuotaExceeded, 0)]
    [InlineData(HttpStatusCode.BadRequest, "", ProviderCallOutcome.Failed, 2)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "", ProviderCallOutcome.Failed, 0)]
    public async Task MapsProviderStatuses(HttpStatusCode status, string body, ProviderCallOutcome outcome, int units)
    {
        var handler = new StubHandler(_ =>
        {
            var message = new HttpResponseMessage(status) { Content = new StringContent(body) };
            if (status == HttpStatusCode.TooManyRequests) message.Headers.RetryAfter = new(TimeSpan.FromSeconds(30));
            return message;
        });
        var response = await Feed(handler).GetFlightsAsync("PUJ", new DateTime(2026, 11, 3, 8, 0, 0), new DateTime(2026, 11, 3, 20, 0, 0));
        Assert.Equal((outcome, units), (response.Outcome, response.Units));
        if (outcome == ProviderCallOutcome.RateLimited) Assert.Equal(TimeSpan.FromSeconds(30), response.RetryAfter);
    }

    [Fact]
    public async Task NeverCallsWithoutAKeyAndRejectsWindowsOverTwelveHours()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        Assert.False(Feed(handler, enabled: false).IsConfigured);
        Assert.False(Feed(handler, key: " ").IsConfigured);
        var disabled = await Feed(handler, enabled: false).GetFlightsAsync("PUJ", new DateTime(2026, 11, 3, 8, 0, 0),
            new DateTime(2026, 11, 3, 9, 0, 0));
        Assert.Equal((ProviderCallOutcome.Unauthorized, 0), (disabled.Outcome, disabled.Units));
        await Assert.ThrowsAsync<ArgumentException>(() => Feed(handler).GetFlightsAsync("PUJ", new DateTime(2026, 11, 3, 8, 0, 0),
            new DateTime(2026, 11, 3, 20, 1, 0)));
        Assert.Empty(handler.Requests);
        Assert.False(new DisabledAirportFlightFeed().IsConfigured);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        public List<(string Uri, string? ApiKey)> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add((request.RequestUri!.ToString(),
                request.Headers.TryGetValues("X-Api-Key", out var values) ? values.Single() : null));
            return Task.FromResult(respond(request));
        }
    }
}
