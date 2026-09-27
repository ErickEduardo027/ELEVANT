using System.Net;
using System.Text.Json;

namespace Elevant.IntegrationTests.Api;

public sealed class ContractDraftOverviewEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task PublishesProtectedDraftOverview()
    {
        using var client = factory.CreateClient();
        using var anonymous = await client.GetAsync("/api/v1/contracts/drafts/overview",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var endpoint = json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/contracts/drafts/overview").GetProperty("get");
        Assert.True(endpoint.GetProperty("responses").TryGetProperty("200", out _));
    }
}
