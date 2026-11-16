using System.Globalization;
using System.Net;
using System.Text.Json;

namespace Elevant.IntegrationTests.Api;

public sealed class SystemPingTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task PingReturnsPublicRuntimeStatusInCamelCase()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/api/v1/system/ping",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);

        await using var body = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            body,
            cancellationToken: TestContext.Current.CancellationToken);

        var root = document.RootElement;
        Assert.Equal("Elevant.Api", root.GetProperty("application").GetString());
        Assert.Equal("ok", root.GetProperty("status").GetString());
        Assert.Equal("Testing", root.GetProperty("environment").GetString());
        Assert.False(root.TryGetProperty("Application", out _));

        var timestampText = root.GetProperty("timestampUtc").GetString();
        Assert.True(DateTimeOffset.TryParse(
            timestampText,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var timestamp));
        Assert.Equal(TimeSpan.Zero, timestamp.Offset);
    }
}
