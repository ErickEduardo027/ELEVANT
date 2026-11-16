using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Infrastructure.Integrations.AirTraffic;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The only test that reads a real network (ADR-0042): one point read of 250 NM around Punta Cana. It runs only with
/// ELEVANT_LIVE_AIR_TRAFFIC=1, against adsb.fi unless ELEVANT_LIVE_AIR_TRAFFIC_PROVIDER names AdsbLol, and without a key;
/// CI never calls a network. It reports counts only, never the answer.
/// </summary>
public sealed class AirTrafficLiveTests
{
    [Fact]
    public async Task LivePointReadAroundPuntaCanaParses()
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_LIVE_AIR_TRAFFIC") != "1") return;
        var name = Environment.GetEnvironmentVariable("ELEVANT_LIVE_AIR_TRAFFIC_PROVIDER") ?? ReadsbProfile.AdsbFi.Name;
        var profile = ReadsbProfile.Find(name);
        Assert.True(profile is not null, "ELEVANT_LIVE_AIR_TRAFFIC_PROVIDER must be AdsbFi or AdsbLol.");
        using var provider = new ReadsbAirTrafficProvider(ReadsbAirTrafficProvider.CreateHttpClient(), profile, null,
            TimeProvider.System);

        var result = await provider.ReadAsync(AirTrafficSettings.Disabled.Area, TestContext.Current.CancellationToken);

        Assert.True(result.Outcome == AirTrafficOutcome.Succeeded, $"{profile.Name} answered {result.Outcome}.");
        Assert.All(result.Aircraft, aircraft =>
        {
            Assert.Matches("^[0-9a-f]{6}$", aircraft.Hex);
            Assert.InRange(aircraft.Latitude, -90, 90);
            Assert.InRange(aircraft.Longitude, -180, 180);
            Assert.True(aircraft.PositionAt <= result.ObservedAt);
        });
        TestContext.Current.SendDiagnosticMessage(
            $"{profile.Name}: {result.Aircraft.Count} aircraft around PUJ, {result.Aircraft.Count(item => item.OnGround)} on " +
            $"the ground, {result.Aircraft.Count(item => item.Callsign is not null)} with a callsign, " +
            $"{result.Aircraft.Count(item => item.Registration is not null)} with a registration.");
    }
}
