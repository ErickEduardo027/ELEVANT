using System.Net;
using System.Text.Json;

namespace Elevant.IntegrationTests.Api;

public sealed class CommercialAirlineManagementEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task ManagementIsPrivateAndPublishedInTheApiContract()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/governance/airlines",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var routes = json.RootElement.GetProperty("paths");
        Assert.True(routes.GetProperty("/api/v1/governance/airlines").TryGetProperty("get", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines").TryGetProperty("post", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines/{id}").TryGetProperty("put", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines/{id}").TryGetProperty("delete", out _));
        Assert.True(routes.GetProperty("/api/v1/governance/airlines/enrichment")
            .TryGetProperty("post", out _));
    }

    [Fact]
    public async Task RampProfileManagementRequiresInternalAuthenticationAndHasAContract()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/human-resources/ramp-profiles",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);

        using var swagger = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var routes = json.RootElement.GetProperty("paths");
        Assert.True(routes.GetProperty("/api/v1/human-resources/ramp-profiles")
            .TryGetProperty("get", out _));
        Assert.True(routes.GetProperty("/api/v1/human-resources/ramp-profiles")
            .TryGetProperty("post", out _));
        Assert.True(routes.GetProperty("/api/v1/human-resources/ramp-profiles/{id}")
            .TryGetProperty("put", out _));
    }
}
