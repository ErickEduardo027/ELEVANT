using System.Net;
using System.Text;
using Elevant.Infrastructure.Integrations.OpenSky;

namespace Elevant.UnitTests.Infrastructure;

public sealed class OpenSkyAircraftTrafficSourceTests
{
    [Fact]
    public async Task UsesFixedBoundsNormalizesNullableFieldsAndSharesCache()
    {
        var clock = new MutableClock();
        var tokenCalls = 0;
        var stateCalls = 0;
        using var client = new HttpClient(new StubHandler(request =>
        {
            if (request.RequestUri!.Host == "auth.opensky-network.org")
            {
                tokenCalls++;
                return Json("{\"access_token\":\"fixture-token\",\"expires_in\":1800}");
            }
            stateCalls++;
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            Assert.Equal("fixture-token", request.Headers.Authorization?.Parameter);
            Assert.Equal("lamin=17&lomin=-73&lamax=21&lomax=-67&extended=1", request.RequestUri.Query.TrimStart('?'));
            return Json($$"""
                {"time":{{clock.GetUtcNow().ToUnixTimeSeconds()}},"states":[
                  ["a1b2c3","TEST123 ","Dominican Republic",{{clock.GetUtcNow().ToUnixTimeSeconds()}},{{clock.GetUtcNow().ToUnixTimeSeconds()}},-68.36,18.56,null,false,120,90,null,null,null,null,false,0,null],
                  ["a1b2c3","TEST123 ","Dominican Republic",{{clock.GetUtcNow().ToUnixTimeSeconds()}},{{clock.GetUtcNow().ToUnixTimeSeconds()}},-68.36,18.56,null,false,120,90,null,null,null,null,false,0,null],
                  ["bad",null,null,null,null,null,null,null,false,null,null,null,null,null,null,false,0,null]
                ]}
                """);
        }));
        using var source = new OpenSkyAircraftTrafficSource(client, Enabled(), clock);
        var reads = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => source.ReadAsync()));
        Assert.All(reads, read =>
        {
            Assert.NotNull(read);
            Assert.False(read.Stale);
            Assert.Single(read.Aircraft);
            Assert.Null(read.Aircraft[0].BarometricAltitudeMeters);
            Assert.Null(read.Aircraft[0].Category);
        });
        Assert.Equal(1, tokenCalls);
        Assert.Equal(1, stateCalls);
    }

    [Fact]
    public async Task RateLimitRetainsOnlyBrieflyMarkedStaleData()
    {
        var clock = new MutableClock();
        var stateCalls = 0;
        using var client = new HttpClient(new StubHandler(request =>
        {
            if (request.RequestUri!.Host == "auth.opensky-network.org")
                return Json("{\"access_token\":\"fixture-token\",\"expires_in\":1800}");
            stateCalls++;
            if (stateCalls == 1)
                return Json($$"""{"time":{{clock.GetUtcNow().ToUnixTimeSeconds()}},"states":[]}""");
            var limited = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            limited.Headers.TryAddWithoutValidation("X-Rate-Limit-Retry-After-Seconds", "600");
            return limited;
        }));
        using var source = new OpenSkyAircraftTrafficSource(client, Enabled(), clock);
        Assert.NotNull(await source.ReadAsync());
        clock.Advance(TimeSpan.FromMinutes(3));
        Assert.True((await source.ReadAsync())?.Stale);
        clock.Advance(TimeSpan.FromMinutes(8));
        Assert.Null(await source.ReadAsync());
        Assert.Equal(2, stateCalls);
    }

    [Fact]
    public async Task DisabledProviderNeverCallsNetwork()
    {
        using var client = new HttpClient(new StubHandler(_ => throw new Exception("No network expected")));
        using var source = new OpenSkyAircraftTrafficSource(client, new OpenSkyOptions(), new MutableClock());
        Assert.Null(await source.ReadAsync());
    }

    [Fact]
    public async Task RefreshesTokenOnceAfterUnauthorizedAndBeforeExpiry()
    {
        var clock = new MutableClock();
        var tokenCalls = 0;
        var stateCalls = 0;
        using var client = new HttpClient(new StubHandler(request =>
        {
            if (request.RequestUri!.Host == "auth.opensky-network.org")
                return Json($$"""{"access_token":"token-{{++tokenCalls}}","expires_in":150}""");
            stateCalls++;
            if (stateCalls == 1) return new HttpResponseMessage(HttpStatusCode.Unauthorized);
            Assert.Equal(stateCalls == 2 ? "token-2" : "token-3",
                request.Headers.Authorization?.Parameter);
            return Json($$"""{"time":{{clock.GetUtcNow().ToUnixTimeSeconds()}},"states":[]}""");
        }));
        using var source = new OpenSkyAircraftTrafficSource(client, Enabled(), clock);
        Assert.NotNull(await source.ReadAsync());
        Assert.Equal(2, tokenCalls);
        Assert.Equal(2, stateCalls);
        clock.Advance(TimeSpan.FromSeconds(121));
        Assert.NotNull(await source.ReadAsync());
        Assert.Equal(3, tokenCalls);
        Assert.Equal(3, stateCalls);
    }

    [Fact]
    public async Task ForbiddenAndTimeoutReturnSanitizedUnavailable()
    {
        var clock = new MutableClock();
        var stateCalls = 0;
        using var client = new HttpClient(new StubHandler(request =>
        {
            if (request.RequestUri!.Host == "auth.opensky-network.org")
                return Json("{\"access_token\":\"fixture-token\",\"expires_in\":1800}");
            stateCalls++;
            if (stateCalls == 1) return new HttpResponseMessage(HttpStatusCode.Forbidden);
            throw new TaskCanceledException("fixture timeout");
        }));
        using var source = new OpenSkyAircraftTrafficSource(client, Enabled(), clock);
        Assert.Null(await source.ReadAsync());
        clock.Advance(TimeSpan.FromMinutes(3));
        Assert.Null(await source.ReadAsync());
        Assert.Equal(1, stateCalls);
        clock.Advance(TimeSpan.FromMinutes(3));
        Assert.Null(await source.ReadAsync());
        Assert.Equal(2, stateCalls);
    }

    private static OpenSkyOptions Enabled() => new()
    {
        Enabled = true,
        ClientId = "fixture-id",
        ClientSecret = "REPLACE_ME_API_KEY",
    };

    private static HttpResponseMessage Json(string value) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(value, Encoding.UTF8, "application/json"),
    };

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) => Task.FromResult(respond(request));
    }

    private sealed class MutableClock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 10, 17, 20, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan amount) => _now += amount;
    }
}
