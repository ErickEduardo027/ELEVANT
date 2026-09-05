using System.Net;
using System.Text.Json;

namespace Elevant.IntegrationTests.Api;

public sealed class DiagnosticsEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    [Theory]
    [InlineData(ElevantApiFactory.PrivateWebOrigin)]
    [InlineData(ElevantApiFactory.PublicWebOrigin)]
    public async Task CorsAllowsEachConfiguredHttpsOrigin(string origin)
    {
        using var client = factory.CreateClient();
        using var allowedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/system/ping");
        allowedRequest.Headers.Add("Origin", origin);

        using var allowedResponse = await client.SendAsync(
            allowedRequest,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, allowedResponse.StatusCode);
        Assert.Equal(origin, allowedResponse.Headers.GetValues(
            "Access-Control-Allow-Origin").Single());
        Assert.Equal("true", allowedResponse.Headers.GetValues(
            "Access-Control-Allow-Credentials").Single());
    }

    [Theory]
    [InlineData(ElevantApiFactory.PrivateWebOrigin)]
    [InlineData(ElevantApiFactory.PublicWebOrigin)]
    public async Task CorsPreflightAllowsAuthorizationAndContentType(string origin)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/system/ping");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "Authorization, Content-Type");

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(origin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("true", response.Headers.GetValues(
            "Access-Control-Allow-Credentials").Single());

        var allowedMethods = GetCommaSeparatedHeaderValues(response, "Access-Control-Allow-Methods");
        var allowedHeaders = GetCommaSeparatedHeaderValues(response, "Access-Control-Allow-Headers");
        Assert.Contains("GET", allowedMethods);
        Assert.Contains("Authorization", allowedHeaders);
        Assert.Contains("Content-Type", allowedHeaders);
    }

    [Fact]
    public async Task CorsPreflightRejectsUnknownOrigin()
    {
        using var client = factory.CreateClient();
        using var rejectedRequest = new HttpRequestMessage(HttpMethod.Options, "/api/v1/system/ping");
        rejectedRequest.Headers.Add(
            "Origin",
            $"{ElevantApiFactory.PrivateWebOrigin}.attacker.example");
        rejectedRequest.Headers.Add("Access-Control-Request-Method", "GET");
        rejectedRequest.Headers.Add(
            "Access-Control-Request-Headers",
            "Authorization, Content-Type");

        using var rejectedResponse = await client.SendAsync(
            rejectedRequest,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NoContent, rejectedResponse.StatusCode);
        Assert.False(rejectedResponse.Headers.Contains("Access-Control-Allow-Origin"));
        Assert.False(rejectedResponse.Headers.Contains("Access-Control-Allow-Credentials"));
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

    private static HashSet<string> GetCommaSeparatedHeaderValues(
        HttpResponseMessage response,
        string headerName) =>
        response.Headers
            .GetValues(headerName)
            .SelectMany(value => value.Split(
                ',',
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
}
