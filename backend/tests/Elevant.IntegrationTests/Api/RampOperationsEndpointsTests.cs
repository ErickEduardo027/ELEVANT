using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class RampOperationsEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid StationId =
        Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OperationId =
        Guid.Parse("70000000-0000-7000-8000-000000000016");
    private static readonly Guid InstallationId =
        Guid.Parse("81000000-0000-7000-8000-000000000001");
    private static readonly Guid IdempotencyKey =
        Guid.Parse("82000000-0000-7000-8000-000000000001");
    private static readonly Guid ReceiptId =
        Guid.Parse("83000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task AssignedOperationsRequireBearerAuthenticationAndAreNeverCached()
    {
        await using var application = CreateApplication(new RampState());
        using var client = application.CreateClient();

        using var response = await client.GetAsync(
            "/api/v1/ramp/operations",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task AssignedOperationsReturnOnlyTheServerResolvedProjectionInCamelCase()
    {
        var state = new RampState
        {
            Actor = CreateActor(),
            ReadResult = RampOperationsReadResult.Success([CreateOperation()]),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/ramp/operations",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);
        var root = document.RootElement;
        var operation = Assert.Single(root.GetProperty("operations").EnumerateArray());
        Assert.Equal(
            "DEV-TAT-0002",
            operation.GetProperty("turnaround").GetProperty("operationCode").GetString());
        Assert.Equal(
            "Assigned",
            operation.GetProperty("operation").GetProperty("status").GetString());
        Assert.Equal(
            "RAMP-AGENT",
            operation.GetProperty("assignment").GetProperty("position").GetProperty("code").GetString());
        Assert.Equal(
            "BAGGAGE",
            operation.GetProperty("services")[0].GetProperty("code").GetString());
        Assert.False(root.TryGetProperty("Operations", out _));
        Assert.Equal(AccountId, state.RequestedAccountId);
        Assert.Equal([StationId], state.RequestedStationIds);
    }

    [Fact]
    public async Task NoCurrentAssignmentsReturnAnExplicitEmptyCollection()
    {
        var state = new RampState
        {
            Actor = CreateActor(),
            ReadResult = RampOperationsReadResult.Success([]),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/ramp/operations",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Empty(payload.GetProperty("operations").EnumerateArray());
    }

    [Fact]
    public async Task MissingRampProfileReturnsGenericForbiddenProblemDetails()
    {
        var state = new RampState
        {
            Actor = CreateActor(),
            ReadResult = RampOperationsReadResult.Failed(
                RampOperationsReadFailure.AgentProfileUnavailable),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/ramp/operations",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        AssertPrivateResponse(response);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(
            "La cuenta no tiene acceso a las operaciones de rampa.",
            problem.GetProperty("title").GetString());
        Assert.False(problem.TryGetProperty("code", out _));
        Assert.DoesNotContain(
            "profile",
            problem.GetRawText(),
            StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StartRequiresBearerAuthenticationAndIsNeverCached()
    {
        await using var application = CreateApplication(new RampState());
        using var client = application.CreateClient();
        using var request = CreateStartRequest();

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task StartUsesRouteAndRequiredUuidHeadersAndReturnsCanonicalReceipt()
    {
        var now = new DateTimeOffset(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);
        var start = new RampOperationStartData(
            ReceiptId,
            new RampGroundOperationData(
                OperationId,
                "InProgress",
                now.AddMinutes(-15),
                now.AddHours(2),
                now,
                null));
        var state = new RampState
        {
            Actor = CreateActor(),
            StartResult = RampOperationStartWriteResult.Success(start, ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateStartRequest();

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(ReceiptId, payload.GetProperty("receiptId").GetGuid());
        var operation = payload.GetProperty("operation");
        Assert.Equal(OperationId, operation.GetProperty("id").GetGuid());
        Assert.Equal("InProgress", operation.GetProperty("status").GetString());
        Assert.Equal(now, operation.GetProperty("actualStartAt").GetDateTimeOffset());
        Assert.Equal(2, payload.EnumerateObject().Count());
        Assert.NotNull(state.StartRequest);
        Assert.Equal(AccountId, state.StartRequest.ActorAccountId);
        Assert.Equal(OperationId, state.StartRequest.OperationId);
        Assert.Equal(InstallationId, state.StartRequest.InstallationId);
        Assert.Equal(IdempotencyKey, state.StartRequest.IdempotencyKey);
    }

    [Theory]
    [InlineData(null, "82000000-0000-7000-8000-000000000001")]
    [InlineData("not-a-uuid", "82000000-0000-7000-8000-000000000001")]
    [InlineData("81000000-0000-7000-8000-000000000001", null)]
    [InlineData("81000000-0000-7000-8000-000000000001", "not-a-uuid")]
    public async Task StartRejectsMissingOrMalformedUuidHeaders(
        string? installationId,
        string? idempotencyKey)
    {
        var state = new RampState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/start");
        if (installationId is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Elevant-Installation-Id", installationId);
        }

        if (idempotencyKey is not null)
        {
            request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        }

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.StartRequest);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal("invalid_ramp_command", problem.GetProperty("code").GetString());
    }

    // 3-I: the deployed APK posts no body; a newer tablet sends the tapped time; an unknown field is a coded 400.
    [Fact]
    public async Task StartTakesNoBodyOrTheTappedTimeAndRejectsUnknownFields()
    {
        var start = new RampOperationStartData(ReceiptId, new RampGroundOperationData(OperationId, "InProgress", null,
            null, new DateTimeOffset(2026, 9, 17, 12, 30, 0, TimeSpan.Zero), null));
        async Task<(HttpStatusCode Status, JsonElement Payload, RampOperationStartWriteRequest? Request)> PostAsync(
            string? json)
        {
            var state = new RampState
            {
                Actor = CreateActor(),
                StartResult = RampOperationStartWriteResult.Success(start, ReceiptId),
            };
            await using var application = CreateApplication(state);
            using var client = CreateAuthenticatedClient(application);
            using var request = CreateStartRequest();
            if (json is not null)
                request.Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
            using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
            return (response.StatusCode, await response.Content.ReadFromJsonAsync<JsonElement>(
                TestContext.Current.CancellationToken), state.StartRequest);
        }

        var bodyless = await PostAsync(null);
        Assert.Equal(HttpStatusCode.OK, bodyless.Status);
        Assert.Null(bodyless.Request!.StartedAt);
        var empty = await PostAsync("{}");
        Assert.Equal(HttpStatusCode.OK, empty.Status);
        Assert.Null(empty.Request!.StartedAt);
        var tapped = await PostAsync("""{"startedAt":"2026-09-17T08:30:00-04:00"}""");
        Assert.Equal(HttpStatusCode.OK, tapped.Status);
        Assert.Equal(new DateTimeOffset(2026, 9, 17, 12, 30, 0, TimeSpan.Zero), tapped.Request!.StartedAt);
        Assert.Equal(TimeSpan.Zero, tapped.Request.StartedAt!.Value.Offset);
        var unknown = await PostAsync("""{"startedAt":"2026-09-17T08:30:00-04:00","agentId":"x"}""");
        Assert.Equal(HttpStatusCode.BadRequest, unknown.Status);
        Assert.Equal("invalid_ramp_command", unknown.Payload.GetProperty("code").GetString());
        Assert.Null(unknown.Request);
    }

    [Theory]
    [InlineData(RampOperationStartWriteFailure.Forbidden, HttpStatusCode.Forbidden, null)]
    [InlineData(RampOperationStartWriteFailure.NotFound, HttpStatusCode.NotFound, "not_found")]
    [InlineData(RampOperationStartWriteFailure.Conflict, HttpStatusCode.Conflict, "ramp_operation_state_conflict")]
    [InlineData(RampOperationStartWriteFailure.IdempotencyKeyConflict, HttpStatusCode.Conflict, "idempotency_conflict")]
    public async Task StartMapsStoreFailuresToStableHttpResponses(
        RampOperationStartWriteFailure failure,
        HttpStatusCode expectedStatus,
        string? expectedCode)
    {
        var state = new RampState
        {
            Actor = CreateActor(),
            StartResult = RampOperationStartWriteResult.Failed(failure),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateStartRequest();

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(expectedStatus, response.StatusCode);
        AssertPrivateResponse(response);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal((int)expectedStatus, problem.GetProperty("status").GetInt32());
        Assert.Equal(expectedCode, problem.TryGetProperty("code", out var code) ? code.GetString() : null);
    }

    [Fact]
    public async Task AStartWithoutAContractInForceKeepsTheConflictAndNamesIt()
    {
        // 3-N04: the deployed APK keeps explaining the 409; the new one shows the code's message.
        var state = new RampState
        {
            Actor = CreateActor(),
            StartResult = RampOperationStartWriteResult.Failed(RampOperationStartWriteFailure.Conflict, ReceiptId,
                "contract_not_in_force"),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateStartRequest();

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        AssertPrivateResponse(response);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal(409, problem.GetProperty("status").GetInt32());
        Assert.Equal("contract_not_in_force", problem.GetProperty("code").GetString());
    }

    [Fact]
    public async Task OpenApiPublishesTheAuthenticatedParameterlessRampRead()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);

        var get = document.RootElement
            .GetProperty("paths")
            .GetProperty("/api/v1/ramp/operations")
            .GetProperty("get");
        Assert.Equal("GetRampAssignedOperations", get.GetProperty("operationId").GetString());
        Assert.False(get.TryGetProperty("parameters", out _));
        var responses = get.GetProperty("responses");
        foreach (var responseCode in new[] { "200", "401", "403", "429", "500" })
        {
            Assert.True(responses.TryGetProperty(responseCode, out _), responseCode);
        }

        var security = Assert.Single(get.GetProperty("security").EnumerateArray());
        Assert.True(security.TryGetProperty("Bearer", out _));
        var schemas = document.RootElement.GetProperty("components").GetProperty("schemas");
        AssertNullableReference(
            schemas,
            "RampAgentAssignmentResponse",
            "position",
            "RampOperationalPositionResponse");
        AssertNullableReference(
            schemas,
            "RampTurnaroundResponse",
            "aircraft",
            "RampAircraftResponse");
        AssertNullableReference(
            schemas,
            "RampTurnaroundResponse",
            "stand",
            "RampStandResponse");
    }

    [Fact]
    public async Task OpenApiPublishesHeaderIdempotentRampStart()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);

        var post = document
            .GetProperty("paths")
            .GetProperty("/api/v1/ramp/operations/{operationId}/start")
            .GetProperty("post");
        Assert.Equal("StartRampOperation", post.GetProperty("operationId").GetString());
        // 3-I: an optional body with the tapped time; the first version of the app posts none.
        var body = post.GetProperty("requestBody");
        Assert.False(body.TryGetProperty("required", out var required) && required.GetBoolean());
        Assert.True(body.GetProperty("content").TryGetProperty("application/json", out _));
        var parameters = post.GetProperty("parameters").EnumerateArray().ToArray();
        Assert.Equal(3, parameters.Length);
        foreach (var name in new[]
                 {
                     "operationId", "X-Elevant-Installation-Id", "Idempotency-Key",
                 })
        {
            var parameter = Assert.Single(parameters, item =>
                string.Equals(item.GetProperty("name").GetString(), name, StringComparison.Ordinal));
            Assert.True(parameter.GetProperty("required").GetBoolean());
            Assert.Equal("uuid", parameter.GetProperty("schema").GetProperty("format").GetString());
        }

        var responses = post.GetProperty("responses");
        foreach (var responseCode in new[] { "200", "400", "401", "403", "404", "409", "429", "500" })
        {
            Assert.True(responses.TryGetProperty(responseCode, out _), responseCode);
        }

        var security = Assert.Single(post.GetProperty("security").EnumerateArray());
        Assert.True(security.TryGetProperty("Bearer", out _));
    }

    private WebApplicationFactory<Program> CreateApplication(RampState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IRampOperationsReadStore>();
            services.RemoveAll<IRampOperationsCommandStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IRampOperationsReadStore>(_ => state);
            services.AddScoped<IRampOperationsCommandStore>(_ => state);
        }));

    private static HttpClient CreateAuthenticatedClient(
        WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            CreateAccessToken());
        return client;
    }

    private static string CreateAccessToken()
    {
        var now = DateTimeOffset.UtcNow;
        var signingKey = new SymmetricSecurityKey(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(
                signingKey,
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(
                    JwtRegisteredClaimNames.Sub,
                    AccountId.ToString("D")),
                new System.Security.Claims.Claim(
                    JwtRegisteredClaimNames.Jti,
                    Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
    }

    private static ActorContext CreateActor() => new(
        AccountId,
        "ramp.agent@dev.elevant.test",
        "Riley Ramp",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000002"),
                "RAMP_AGENT",
                "Ramp Agent",
                PortalKind.RampMobileApp,
                "ramp_agent"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000002"),
                Guid.Parse("10000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM Development",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [new ActorStationScope(StationId, "PUJ")]);

    private static RampAssignedOperationData CreateOperation()
    {
        var scheduled = new DateTimeOffset(2026, 8, 19, 12, 0, 0, TimeSpan.Zero);
        return new RampAssignedOperationData(
            new RampAgentAssignmentData(
                Guid.Parse("70000000-0000-7000-8000-000000000018"),
                Guid.Parse("50000000-0000-7000-8000-000000000001"),
                new RampOperationalPositionData(
                    Guid.Parse("50000000-0000-7000-8000-000000000004"),
                    "RAMP-AGENT",
                    "Ramp agent"),
                "primary",
                scheduled),
            new RampGroundOperationData(
                Guid.Parse("70000000-0000-7000-8000-000000000016"),
                "Assigned",
                scheduled.AddMinutes(15),
                scheduled.AddHours(2.5),
                null,
                null),
            new RampTurnaroundData(
                Guid.Parse("70000000-0000-7000-8000-000000000012"),
                "DEV-TAT-0002",
                new DateOnly(2026, 8, 19),
                "Confirmed",
                new RampStationData(
                    StationId,
                    "PUJ",
                    "AVIAM PUJ Development",
                    "America/Santo_Domingo"),
                new RampAirlineData(
                    Guid.Parse("20000000-0000-7000-8000-000000000010"),
                    "ZZ",
                    "DZZ",
                    "Demo Airlines"),
                null,
                null,
                null,
                null),
            [
                new RampOperationServiceData(
                    Guid.Parse("70000000-0000-7000-8000-000000000017"),
                    1,
                    Guid.Parse("30000000-0000-7000-8000-000000000001"),
                    "BAGGAGE",
                    "Baggage handling",
                    1,
                    0,
                    "operation",
                    "Planned"),
            ]);
    }

    private static HttpRequestMessage CreateStartRequest()
    {
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/start");
        request.Headers.Add("X-Elevant-Installation-Id", InstallationId.ToString("D"));
        request.Headers.Add("Idempotency-Key", IdempotencyKey.ToString("D"));
        return request;
    }

    private static void AssertPrivateResponse(HttpResponseMessage response)
    {
        Assert.Contains(
            "no-store",
            response.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);
        Assert.Contains("no-cache", response.Headers.Pragma.Select(value => value.Name));
    }

    private static void AssertNullableReference(
        JsonElement schemas,
        string schemaName,
        string propertyName,
        string referencedSchemaName)
    {
        var property = schemas
            .GetProperty(schemaName)
            .GetProperty("properties")
            .GetProperty(propertyName);
        Assert.True(property.GetProperty("nullable").GetBoolean());
        var reference = Assert.Single(property.GetProperty("allOf").EnumerateArray());
        Assert.Equal(
            $"#/components/schemas/{referencedSchemaName}",
            reference.GetProperty("$ref").GetString());
    }

    private sealed class RampState :
        IActorContextResolver,
        IRampOperationsReadStore,
        IRampOperationsCommandStore
    {
        public ActorContext? Actor { get; init; }

        public RampOperationsReadResult ReadResult { get; init; } =
            RampOperationsReadResult.Success([]);

        public RampOperationStartWriteResult StartResult { get; init; } =
            RampOperationStartWriteResult.Failed(RampOperationStartWriteFailure.Conflict);

        public Guid? RequestedAccountId { get; private set; }

        public IReadOnlyCollection<Guid>? RequestedStationIds { get; private set; }

        public RampOperationStartWriteRequest? StartRequest { get; private set; }

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Actor);
        }

        public Task<RampOperationsReadResult> GetActiveAssignedOperationsAsync(
            Guid accountId,
            IReadOnlyCollection<Guid> allowedStationIds,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            RequestedAccountId = accountId;
            RequestedStationIds = allowedStationIds;
            return Task.FromResult(ReadResult);
        }

        public Task<RampOperationStartWriteResult> StartOperationAsync(
            RampOperationStartWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            StartRequest = request;
            return Task.FromResult(StartResult);
        }
    }
}
