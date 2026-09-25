using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Api;

public sealed class DiagnosticsEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    [Fact]
    public void DevelopmentRequestLoggingDoesNotRecordSignalRQueryTokens()
    {
        using var application = factory.WithWebHostBuilder(builder =>
            builder.UseEnvironment("Development"));
        var configuration = application.Services.GetRequiredService<IConfiguration>();

        Assert.Equal(
            "Warning",
            configuration["Logging:LogLevel:Microsoft.AspNetCore.Hosting.Diagnostics"]);
    }

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
    public async Task CorsPreflightAllowsAuthorizationContentTypeAndConcurrencyHeader(string origin)
    {
        using var client = factory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/system/ping");
        request.Headers.Add("Origin", origin);
        request.Headers.Add("Access-Control-Request-Method", "GET");
        request.Headers.Add("Access-Control-Request-Headers", "Authorization, Content-Type, If-Match");

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
        Assert.Contains("If-Match", allowedHeaders);
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
    public async Task TestingEnvironmentPublishesStableVersionOneOpenApiContract()
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
        var pingOperation = root
            .GetProperty("paths")
            .GetProperty("/api/v1/system/ping")
            .GetProperty("get");
        Assert.Equal("GetSystemPing", pingOperation.GetProperty("operationId").GetString());

        var responses = pingOperation.GetProperty("responses");
        Assert.Equal(
            ["200", "429", "500"],
            responses.EnumerateObject().Select(response => response.Name).Order().ToArray());
        AssertResponseContent(
            responses,
            "200",
            "application/json",
            "#/components/schemas/SystemPingResponse");
        AssertResponseContent(
            responses,
            "429",
            "application/problem+json",
            "#/components/schemas/ProblemDetails");
        AssertResponseContent(
            responses,
            "500",
            "application/problem+json",
            "#/components/schemas/ProblemDetails");

        var components = root.GetProperty("components");
        var pingSchema = components
            .GetProperty("schemas")
            .GetProperty("SystemPingResponse");
        var requiredProperties = pingSchema
            .GetProperty("required")
            .EnumerateArray()
            .Select(property => property.GetString()
                ?? throw new InvalidOperationException("OpenAPI required property cannot be null."))
            .ToHashSet(StringComparer.Ordinal);
        Assert.True(requiredProperties.SetEquals(
            ["application", "status", "environment", "timestampUtc"]));

        var properties = pingSchema.GetProperty("properties");
        var propertyNames = properties
            .EnumerateObject()
            .Select(property => property.Name)
            .ToHashSet(StringComparer.Ordinal);
        Assert.True(propertyNames.SetEquals(requiredProperties));
        AssertStringProperty(properties, "application");
        AssertStringProperty(properties, "status");
        AssertStringProperty(properties, "environment");
        AssertStringProperty(properties, "timestampUtc", "date-time");

        var sessionPath = root
            .GetProperty("paths")
            .GetProperty("/api/v1/auth/session");
        var createSession = sessionPath.GetProperty("post");
        Assert.Equal("CreateSession", createSession.GetProperty("operationId").GetString());
        Assert.False(createSession.TryGetProperty("security", out _));
        Assert.Equal(
            ["200", "400", "401", "409", "413", "415", "429", "500", "503"],
            createSession
                .GetProperty("responses")
                .EnumerateObject()
                .Select(response => response.Name)
                .Order()
                .ToArray());
        AssertSchemaReference(
            createSession
                .GetProperty("requestBody")
                .GetProperty("content")
                .GetProperty("application/json")
                .GetProperty("schema"),
            "#/components/schemas/CreateSessionRequest",
            nullable: false);
        Assert.True(createSession.GetProperty("requestBody").GetProperty("required").GetBoolean());
        AssertResponseContent(
            createSession.GetProperty("responses"),
            "200",
            "application/json",
            "#/components/schemas/SessionResponse");

        var getCurrentSession = sessionPath.GetProperty("get");
        Assert.Equal(
            "GetCurrentSession",
            getCurrentSession.GetProperty("operationId").GetString());
        Assert.Equal(
            ["200", "401", "429", "500"],
            getCurrentSession
                .GetProperty("responses")
                .EnumerateObject()
                .Select(response => response.Name)
                .Order()
                .ToArray());
        AssertResponseContent(
            getCurrentSession.GetProperty("responses"),
            "200",
            "application/json",
            "#/components/schemas/CurrentSessionResponse");
        var securityRequirement = Assert.Single(
            getCurrentSession.GetProperty("security").EnumerateArray());
        Assert.Empty(securityRequirement.GetProperty("Bearer").EnumerateArray());

        var changePassword = root.GetProperty("paths")
            .GetProperty("/api/v1/auth/password-change")
            .GetProperty("post");
        Assert.Equal("ChangePassword", changePassword.GetProperty("operationId").GetString());
        Assert.False(changePassword.TryGetProperty("security", out _));
        AssertSchemaReference(
            changePassword.GetProperty("requestBody")
                .GetProperty("content").GetProperty("application/json").GetProperty("schema"),
            "#/components/schemas/ChangePasswordRequest",
            nullable: false);

        var schemas = components.GetProperty("schemas");
        var credentialProperties = schemas
            .GetProperty("CreateSessionRequest")
            .GetProperty("properties");
        Assert.Equal(1, credentialProperties.GetProperty("email").GetProperty("minLength").GetInt32());
        var passwordProperty = credentialProperties.GetProperty("password");
        Assert.Equal("password", passwordProperty.GetProperty("format").GetString());
        Assert.True(passwordProperty.GetProperty("writeOnly").GetBoolean());
        AssertStringEnum(
            schemas,
            "SessionPortal",
            "back_office",
            "ramp_mobile_app",
            "airline_portal");
        AssertStringEnum(
            schemas,
            "SessionOrganizationType",
            "aviam_operator",
            "airline_customer");
        AssertStringEnum(
            schemas,
            "SessionMembershipKind",
            "internal_staff",
            "airline_client");

        var bearerScheme = components
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

    private static void AssertResponseContent(
        JsonElement responses,
        string statusCode,
        string mediaType,
        string schemaReference)
    {
        var content = responses
            .GetProperty(statusCode)
            .GetProperty("content");
        Assert.Equal(
            [mediaType],
            content.EnumerateObject().Select(entry => entry.Name).ToArray());
        AssertSchemaReference(
            content.GetProperty(mediaType).GetProperty("schema"),
            schemaReference,
            nullable: false);
    }

    private static void AssertSchemaReference(
        JsonElement schema,
        string expectedReference,
        bool nullable)
    {
        var reference = schema.TryGetProperty("$ref", out var directReference)
            ? directReference
            : Assert.Single(schema.GetProperty("allOf").EnumerateArray())
                .GetProperty("$ref");
        Assert.Equal(expectedReference, reference.GetString());
        Assert.Equal(
            nullable,
            schema.TryGetProperty("nullable", out var nullableProperty) &&
            nullableProperty.GetBoolean());
    }

    private static void AssertStringProperty(
        JsonElement properties,
        string propertyName,
        string? expectedFormat = null)
    {
        var property = properties.GetProperty(propertyName);
        Assert.Equal("string", property.GetProperty("type").GetString());
        Assert.Equal(
            expectedFormat,
            property.TryGetProperty("format", out var format) ? format.GetString() : null);
        Assert.False(
            property.TryGetProperty("nullable", out var nullable) && nullable.GetBoolean(),
            $"{propertyName} must remain non-nullable in OpenAPI.");
    }

    private static void AssertStringEnum(
        JsonElement schemas,
        string schemaName,
        params string[] expectedValues)
    {
        var schema = schemas.GetProperty(schemaName);
        Assert.Equal("string", schema.GetProperty("type").GetString());
        Assert.Equal(
            expectedValues,
            schema.GetProperty("enum")
                .EnumerateArray()
                .Select(value => value.GetString())
                .ToArray());
    }
}
