using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Integrations.AeroDataBox;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The only test that calls AeroDataBox (ADR-0028): one FIDS read of PUJ, 2 units. Runs only with
/// ELEVANT_LIVE_AERODATABOX=1 and AeroDataBox__ApiKey set; CI never calls the provider.
/// </summary>
public sealed class AeroDataBoxLiveTests
{
    [Fact]
    public async Task LiveFidsReadOfPuntaCanaParses()
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_LIVE_AERODATABOX") != "1") return;
        var key = Environment.GetEnvironmentVariable("AeroDataBox__ApiKey");
        Assert.False(string.IsNullOrWhiteSpace(key), "Set AeroDataBox__ApiKey for the live test.");
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var feed = new AeroDataBoxAirportFlightFeed(http, new AeroDataBoxOptions { Enabled = true, ApiKey = key });
        var zone = TimeZoneInfo.FindSystemTimeZoneById("America/Santo_Domingo");
        var now = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).DateTime;
        var from = new DateTime(now.Year, now.Month, now.Day, now.Hour, 0, 0).AddHours(-2);

        var response = await feed.GetFlightsAsync("PUJ", from, from.AddHours(12), TestContext.Current.CancellationToken);

        Assert.True(response.Outcome is ProviderCallOutcome.Succeeded or ProviderCallOutcome.NoContent,
            $"AeroDataBox answered {response.Outcome} ({response.HttpStatus}).");
        Assert.Equal(2, response.Units);
        Assert.All(response.Flights, flight =>
        {
            Assert.False(string.IsNullOrWhiteSpace(flight.Number));
            Assert.True(flight.ScheduledUtc > DateTimeOffset.UtcNow.AddDays(-1));
        });
        var summary =
            $"PUJ FIDS: {response.Flights.Count} legs, {response.Flights.Count(flight => flight.Counterpart?.IcaoCode is not null)} " +
            $"with the other airport, {response.Flights.Select(flight => flight.Airline?.IataCode).Distinct().Count()} airlines.";
        TestContext.Current.SendDiagnosticMessage(summary);
        // Optional local summary (counts only, never the key or the payload).
        if (Environment.GetEnvironmentVariable("ELEVANT_LIVE_AERODATABOX_SUMMARY") is { Length: > 0 } path)
            await File.WriteAllTextAsync(path, summary, TestContext.Current.CancellationToken);
    }
}
