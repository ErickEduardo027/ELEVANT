using System.Net;
using System.Text;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Integrations.AeroDataBox;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0028 (note of 15 November 2026): the AeroDataBox reference reads, against synthetic documents shaped like the
/// direct API contracts (AircraftContractPagedCollectionContract, AircraftContract, DailyRouteStatContract,
/// AirportDelayContract). The data is invented; the live API is never called.
/// </summary>
public sealed class AeroDataBoxReferenceProviderTests
{
    private const string Fleet = """
        {
          "totalCount": 87, "pageOffset": 0, "pageSize": 25, "hasNextPage": true, "count": 3,
          "items": [
            { "id": 1, "reg": "zz-001", "active": true, "airlineName": "Demo Airlines", "icaoCode": "A320",
              "model": "Airbus A320", "isFreighter": false, "verified": true, "numRegistrations": 1, "ageYears": 7.36 },
            { "id": 2, "reg": "ZZ-002", "active": true, "icaoCode": "A320", "model": "Airbus A320", "isFreighter": false,
              "verified": true, "numRegistrations": 1 },
            { "id": 3, "reg": "ZZ-003", "active": true, "icaoCode": "B738", "model": "Boeing 737-800", "isFreighter": false,
              "verified": true, "numRegistrations": 2 }
          ]
        }
        """;

    private const string Aircraft = """
        {
          "id": 9, "reg": "HI1055", "active": true, "serial": "99999", "hexIcao": "0c2abc", "airlineName": "Demo Airlines",
          "iataType": "7m8", "icaoCode": "B38M", "model": "Boeing 737 MAX 8", "modelCode": "737-8", "numSeats": 189,
          "rolloutDate": "2022-02-01T00:00:00Z", "firstFlightDate": "2022-03-01T00:00:00Z",
          "deliveryDate": "2022-04-02T00:00:00Z", "registrationDate": "2022-04-02T00:00:00Z", "typeName": "Boeing 737",
          "numEngines": 2, "engineType": "Jet", "isFreighter": false, "ageYears": 4.2, "verified": true, "numRegistrations": 1
        }
        """;

    private const string Routes = """
        {
          "routes": [
            { "destination": { "icao": "KJFK", "iata": "JFK", "name": "New York JFK", "municipalityName": "New York",
                "countryCode": "US", "location": { "lat": 40.6398, "lon": -73.7789 } },
              "averageDailyFlights": 3.5, "operators": [ { "name": "Demo Airlines", "iata": "ZZ" } ] },
            { "destination": { "icao": "CYYZ", "iata": "YYZ", "name": "Toronto Pearson", "countryCode": "CA",
                "location": { "lat": 43.6772, "lon": -79.6306 } },
              "averageDailyFlights": 6.0, "operators": [ { "name": "Maple Demo" }, { "name": "Maple Demo" } ] },
            { "destination": { "name": "Nowhere" }, "averageDailyFlights": 0, "operators": [] }
          ]
        }
        """;

    private const string Delays = """
        {
          "airportIcao": "MDPC",
          "from": { "utc": "2026-11-15 12:00Z", "local": "2026-11-15 08:00-04:00" },
          "to": { "utc": "2026-11-15 14:00Z", "local": "2026-11-15 10:00-04:00" },
          "departuresDelayInformation": { "numTotal": 14, "numQualifiedTotal": 12, "numCancelled": 1,
            "medianDelay": "00:08:10", "delayIndex": 1.24 },
          "arrivalsDelayInformation": { "numTotal": 16, "numQualifiedTotal": 15, "numCancelled": 0,
            "medianDelay": "-00:03:00", "delayIndex": 0.5 }
        }
        """;

    private static AeroDataBoxReferenceProvider Provider(StubHandler handler, bool enabled = true) =>
        new(new HttpClient(handler), new AeroDataBoxOptions { Enabled = enabled, ApiKey = "synthetic-key" });

    private static StubHandler Answer(string json) => new(_ => new HttpResponseMessage(HttpStatusCode.OK)
        { Content = new StringContent(json, Encoding.UTF8, "application/json") });

    [Fact]
    public async Task TheFleetIsOnePageOfTheStarterSizeAndItsTotal()
    {
        var handler = Answer(Fleet);
        var call = await Provider(handler).GetAirlineFleetAsync("zza", TestContext.Current.CancellationToken);

        Assert.Equal((ProviderCallOutcome.Succeeded, 6, 87, 3), (call.Outcome, call.Units, call.Value!.TotalAircraft,
            call.Value.Sample.Count));
        Assert.Equal("ZZ-001", call.Value.Sample[0].Registration);
        Assert.Equal(7.4, call.Value.Sample[0].AgeYears);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://api.aerodatabox.com/airlines/ZZA/aircrafts?pageSize=25&pageOffset=0&withRegistrations=false", request.Uri);
        Assert.Equal("synthetic-key", request.ApiKey);
    }

    [Fact]
    public async Task AnAircraftIsReadByItsRegistrationForOneUnit()
    {
        var handler = Answer(Aircraft);
        var call = await Provider(handler).GetAircraftAsync("HI1055", TestContext.Current.CancellationToken);

        var aircraft = call.Value!;
        Assert.Equal((1, "B38M", "7M8", "Demo Airlines", "0C2ABC", 189), (call.Units, aircraft.IcaoType, aircraft.IataType,
            aircraft.Operator, aircraft.ModeS, aircraft.Seats));
        Assert.Equal((new DateOnly(2022, 3, 1), 4.2, true), (aircraft.FirstFlight, aircraft.AgeYears, aircraft.Active));
        Assert.Equal("https://api.aerodatabox.com/aircrafts/reg/HI1055?withImage=false&withRegistrations=false",
            Assert.Single(handler.Requests).Uri);
    }

    [Fact]
    public async Task TheRoutesComeMostFrequentFirstWithTheirPositions()
    {
        var handler = Answer(Routes);
        var call = await Provider(handler).GetDailyRoutesAsync("mdpc", TestContext.Current.CancellationToken);

        var routes = call.Value!.Routes;
        Assert.Equal(["YYZ", "JFK"], routes.Select(route => route.DestinationIata));
        Assert.Equal((6.0, 43.6772, -79.6306), (routes[0].AverageDailyFlights, routes[0].Latitude, routes[0].Longitude));
        Assert.Equal(["Maple Demo"], routes[0].Operators);
        Assert.Equal(6, call.Units);
        Assert.Equal("https://api.aerodatabox.com/airports/icao/MDPC/stats/routes/daily", Assert.Single(handler.Requests).Uri);
    }

    [Fact]
    public async Task TheDelaysAreReadByIataOrIcaoWithTheirMedianInMinutes()
    {
        var handler = Answer(Delays);
        var provider = Provider(handler);
        var call = await provider.GetDelaysAsync("MDPC", TestContext.Current.CancellationToken);
        await provider.GetDelaysAsync("sdq", TestContext.Current.CancellationToken);

        var delays = call.Value!;
        Assert.Equal((-3, 15, 0.5), (delays.Arrivals.MedianDelayMinutes, delays.Arrivals.Qualified, delays.Arrivals.DelayIndex));
        Assert.Equal((8, 1, 1.24), (delays.Departures.MedianDelayMinutes, delays.Departures.Cancelled, delays.Departures.DelayIndex));
        Assert.Equal(new DateTimeOffset(2026, 11, 15, 14, 0, 0, TimeSpan.Zero), delays.To);
        Assert.Equal(["https://api.aerodatabox.com/airports/icao/MDPC/delays", "https://api.aerodatabox.com/airports/iata/SDQ/delays"],
            handler.Requests.Select(request => request.Uri));
    }

    [Theory]
    [InlineData(HttpStatusCode.NoContent, "", ProviderCallOutcome.NoContent, 1)]
    [InlineData(HttpStatusCode.Unauthorized, "", ProviderCallOutcome.Unauthorized, 0)]
    [InlineData(HttpStatusCode.TooManyRequests, "Monthly quota exceeded", ProviderCallOutcome.QuotaExceeded, 0)]
    [InlineData(HttpStatusCode.TooManyRequests, "slow down", ProviderCallOutcome.RateLimited, 0)]
    [InlineData(HttpStatusCode.BadRequest, "", ProviderCallOutcome.Failed, 1)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "", ProviderCallOutcome.Failed, 0)]
    public async Task EveryAnswerHasItsOutcomeAndItsUnits(HttpStatusCode status, string body, ProviderCallOutcome outcome, int units)
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(status) { Content = new StringContent(body) });
        var call = await Provider(handler).GetAircraftAsync("N12345", TestContext.Current.CancellationToken);

        Assert.Equal((outcome, units), (call.Outcome, call.Units));
        Assert.Null(call.Value);
    }

    [Fact]
    public async Task WithoutTheKeyNothingIsCalled()
    {
        var handler = Answer(Aircraft);
        var call = await Provider(handler, enabled: false).GetAircraftAsync("HI1055", TestContext.Current.CancellationToken);

        Assert.Equal((ProviderCallOutcome.Unauthorized, 0), (call.Outcome, call.Units));
        Assert.Empty(handler.Requests);
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
