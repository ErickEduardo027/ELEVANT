using System.Net;
using System.Text.Json;

namespace Elevant.IntegrationTests.Api;

public sealed class DiagnosticsEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public async Task CorsAllowsConfiguredOriginAndRejectsUnknownOrigin()
    {
        using var client = factory.CreateClient();
        using var allowedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/system/ping");
        allowedRequest.Headers.Add("Origin", "http://localhost");

        using var allowedResponse = await client.SendAsync(
            allowedRequest,
            TestContext.Current.CancellationToken);

        Assert.Equal("http://localhost", allowedResponse.Headers.GetValues(
            "Access-Control-Allow-Origin").Single());

        using var rejectedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/system/ping");
        rejectedRequest.Headers.Add("Origin", "https://untrusted.example");

        using var rejectedResponse = await client.SendAsync(
            rejectedRequest,
            TestContext.Current.CancellationToken);

        Assert.False(rejectedResponse.Headers.Contains("Access-Control-Allow-Origin"));
    }

    [Fact]
    public async Task LivenessDoesNotConnectToSqlServer()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/health",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var body = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            body,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal("healthy", document.RootElement.GetProperty("status").GetString());
    }

    [Fact]
    public async Task ReadinessRejectsAnUnavailableOrIncorrectDatabaseTarget()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/health/ready",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        await using var body = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            body,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal("unhealthy", document.RootElement.GetProperty("status").GetString());
        var checks = document.RootElement.GetProperty("checks")
            .EnumerateArray()
            .ToDictionary(
                check => check.GetProperty("name").GetString()!,
                check => check.GetProperty("status").GetString());

        Assert.Equal("unhealthy", checks["database-target"]);
        Assert.Equal("unhealthy", checks["sql-server"]);
    }

    [Fact]
    public async Task TestingEnvironmentPublishesVersionOneOpenApiDocument()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        await using var body = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            body,
            cancellationToken: TestContext.Current.CancellationToken);
        var root = document.RootElement;
        Assert.Equal("Elevant API", root.GetProperty("info").GetProperty("title").GetString());
        Assert.True(root.GetProperty("paths").TryGetProperty("/api/v1/system/ping", out _));

        var bearerScheme = root
            .GetProperty("components")
            .GetProperty("securitySchemes")
            .GetProperty("Bearer");
        Assert.Equal("http", bearerScheme.GetProperty("type").GetString());
        Assert.Equal("bearer", bearerScheme.GetProperty("scheme").GetString());
    }
}
