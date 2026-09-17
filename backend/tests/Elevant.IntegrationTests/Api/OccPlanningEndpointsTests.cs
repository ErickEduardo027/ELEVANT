using System.Net;
using System.Net.Http.Headers;
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

public sealed class OccPlanningEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SecondStationId = Guid.Parse("20000000-0000-7000-8000-000000000013");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
    private static readonly DateOnly FixtureDate = new(2026, 8, 19);

    [Fact]
    public async Task SnapshotRequiresBearerAuthenticationAndIsNeverCached()
    {
        await using var application = CreateApplication(new OccState());
        using var client = application.CreateClient();

        using var response = await client.GetAsync(
            "/api/v1/occ/planning",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task SnapshotReturnsScopedCanonicalProjectionInCamelCase()
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            LatestDate = FixtureDate,
            Snapshot = CreateSnapshot(),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            "/api/v1/occ/planning",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);
        var root = document.RootElement;
        Assert.Equal("PUJ", root.GetProperty("station").GetProperty("code").GetString());
        Assert.Equal("2026-08-19", root.GetProperty("date").GetString());
        Assert.Equal("DEV-TAT-0002", root.GetProperty("turnarounds")[0].GetProperty("operationCode").GetString());
        Assert.False(root.TryGetProperty("Turnarounds", out _));
        Assert.Equal(StationId, state.LatestDateStationId);
        Assert.Equal((StationId, FixtureDate), state.SnapshotRequest);
    }

    [Fact]
    public async Task AuthenticatedActorWithoutOccRoleIsForbidden()
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Code = "CONTRACTS" }],
        };
        await using var application = CreateApplication(new OccState { Actor = actor });
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning?stationId={StationId:D}&date=2026-08-19",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        AssertPrivateResponse(response);
    }

    [Theory]
    [InlineData("portal")]
    [InlineData("organization")]
    [InlineData("membership")]
    public async Task OptionsRejectActorsOutsideTheCompleteOccAuthorizationProfile(string variant)
    {
        var baseline = CreateActor();
        var actor = variant switch
        {
            "portal" => baseline with
            {
                Roles = [baseline.Roles[0] with { Portal = PortalKind.RampMobileApp }],
            },
            "organization" => baseline with
            {
                Memberships =
                [
                    baseline.Memberships[0] with
                    {
                        OrganizationType = OrganizationType.AirlineCustomer,
                    },
                ],
            },
            "membership" => baseline with
            {
                Memberships =
                [
                    baseline.Memberships[0] with
                    {
                        Kind = MembershipKind.AirlineClient,
                    },
                ],
            },
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, null),
        };
        var state = new OccState { Actor = actor, Options = CreateOptions() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning/options?turnaroundId={TurnaroundId:D}",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Null(state.OptionStationIds);
    }

    [Fact]
    public async Task OptionsWithNoStationScopesAreNotFoundWithoutQueryingPersistence()
    {
        var state = new OccState
        {
            Actor = CreateActor() with { StationScopes = [] },
            Options = CreateOptions(),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning/options?turnaroundId={TurnaroundId:D}",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Null(state.OptionStationIds);
    }

    [Fact]
    public async Task OptionsPassAllStationScopesToTheScopedStore()
    {
        var actor = CreateActor() with
        {
            StationScopes =
            [
                new ActorStationScope(StationId, "PUJ"),
                new ActorStationScope(SecondStationId, "SDQ"),
            ],
        };
        var state = new OccState { Actor = actor, Options = CreateOptions() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning/options?turnaroundId={TurnaroundId:D}",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal([StationId, SecondStationId], state.OptionStationIds);
    }

    [Fact]
    public async Task SnapshotAcceptsAnExplicitAuthorizedStationWhenActorHasMultipleScopes()
    {
        var actor = CreateActor() with
        {
            StationScopes =
            [
                new ActorStationScope(StationId, "PUJ"),
                new ActorStationScope(SecondStationId, "SDQ"),
            ],
        };
        var state = new OccState { Actor = actor, Snapshot = CreateSnapshot() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning?stationId={StationId:D}&date=2026-08-19",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal((StationId, FixtureDate), state.SnapshotRequest);
    }

    [Fact]
    public async Task MalformedDateAndMissingTurnaroundIdAreBadRequests()
    {
        await using var application = CreateApplication(new OccState { Actor = CreateActor() });
        using var client = CreateAuthenticatedClient(application);

        using var malformedDate = await client.GetAsync(
            "/api/v1/occ/planning?date=not-a-date",
            TestContext.Current.CancellationToken);
        using var missingTurnaround = await client.GetAsync(
            "/api/v1/occ/planning/options",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, malformedDate.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, missingTurnaround.StatusCode);
        AssertPrivateResponse(malformedDate);
        AssertPrivateResponse(missingTurnaround);
    }

    [Fact]
    public async Task MissingOrOutOfScopeTurnaroundUsesSameNotFoundResponse()
    {
        var state = new OccState { Actor = CreateActor(), Options = null };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning/options?turnaroundId={Guid.NewGuid():D}",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertPrivateResponse(response);
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(
            "The OCC planning resource was not found.",
            document.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task OptionsReturnStableEligibilityReasons()
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            Options = CreateOptions(),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning/options?turnaroundId={TurnaroundId:D}",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);
        var agent = document.RootElement.GetProperty("agents")[0];
        Assert.False(agent.GetProperty("eligible").GetBoolean());
        Assert.Equal("shift_not_compatible", agent.GetProperty("eligibilityReasons")[0].GetString());
        Assert.Equal([StationId], state.OptionStationIds);
    }

    [Fact]
    public async Task OverlappingApplicableContractsReturnGenericConflict()
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            OptionsFailure = OccPlanningOptionsReadFailure.ContractConflict,
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/occ/planning/options?turnaroundId={TurnaroundId:D}",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        AssertPrivateResponse(response);
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(
            "The OCC planning request conflicts with current operational data.",
            document.RootElement.GetProperty("title").GetString());
        Assert.DoesNotContain(
            "contract",
            document.RootElement.GetRawText(),
            StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task OpenApiPublishesBothOccPlanningOperations()
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
        var paths = document.RootElement.GetProperty("paths");

        Assert.True(paths.TryGetProperty("/api/v1/occ/planning", out var snapshot));
        Assert.True(snapshot.TryGetProperty("get", out _));
        Assert.True(paths.TryGetProperty("/api/v1/occ/planning/options", out var options));
        Assert.True(options.TryGetProperty("get", out var optionsGet));
        Assert.True(optionsGet.GetProperty("responses").TryGetProperty("409", out _));

        var schemas = document.RootElement
            .GetProperty("components")
            .GetProperty("schemas");
        AssertNullableReference(
            schemas,
            "OccTurnaroundResponse",
            "aircraft",
            "OccAircraftResponse");
        AssertNullableReference(
            schemas,
            "OccStandResponse",
            "terminal",
            "OccTerminalResponse");
        AssertNullableReference(
            schemas,
            "OccPlanningOptionsResponse",
            "contract",
            "OccContractOptionResponse");
    }

    private WebApplicationFactory<Program> CreateApplication(OccState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IOccPlanningReadStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IOccPlanningReadStore>(_ => state);
        }));

    private static HttpClient CreateAuthenticatedClient(WebApplicationFactory<Program> application)
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
            SigningCredentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
            ]),
            TokenType = "at+jwt",
        });
    }

    private static ActorContext CreateActor() => new(
        AccountId,
        "admin.occ@dev.elevant.test",
        "Alex Operations",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000001"),
                "ADMIN_OCC",
                "Admin OCC",
                PortalKind.BackOffice,
                "admin_occ"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000001"),
                Guid.Parse("10000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM Development",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [new ActorStationScope(StationId, "PUJ")]);

    private static OccPlanningSnapshotData CreateSnapshot()
    {
        var station = CreateStation();
        var turnaround = new OccTurnaroundData(
            TurnaroundId,
            "DEV-TAT-0002",
            FixtureDate,
            "Confirmed",
            new OccAirlineData(
                Guid.Parse("20000000-0000-7000-8000-000000000010"),
                "ZZ",
                "DZZ",
                "Demo Airlines"),
            null,
            null,
            null,
            null,
            null,
            [],
            [],
            []);
        return new OccPlanningSnapshotData(station, FixtureDate, [turnaround]);
    }

    private static OccPlanningOptionsSourceData CreateOptions() => new(
        new OccPlanningTurnaroundContextData(
            TurnaroundId,
            "DEV-TAT-0002",
            FixtureDate,
            CreateStation(),
            null,
            new DateTimeOffset(2026, 8, 19, 12, 15, 0, TimeSpan.Zero)),
        null,
        [],
        [
            new OccAgentCandidateData(
                Guid.Parse("50000000-0000-7000-8000-000000000001"),
                "Riley Ramp",
                "DEV-RA-001",
                IsActive: true,
                HasMobileAccount: true,
                HasStationScope: true,
                HasTerminalScope: true,
                HasCurrentQualification: true,
                HasCurrentAirportId: true,
                HasCurrentRampDriverLicense: true,
                HasCompatibleShift: false),
        ]);

    private static OccStationData CreateStation() => new(
        StationId,
        "PUJ",
        "AVIAM PUJ Development",
        "America/Santo_Domingo");

    private static void AssertPrivateResponse(HttpResponseMessage response)
    {
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
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

    private sealed class OccState : IActorContextResolver, IOccPlanningReadStore
    {
        public ActorContext? Actor { get; init; }

        public DateOnly? LatestDate { get; init; }

        public OccPlanningSnapshotData? Snapshot { get; init; }

        public OccPlanningOptionsSourceData? Options { get; init; }

        public OccPlanningOptionsReadFailure? OptionsFailure { get; init; }

        public Guid? LatestDateStationId { get; private set; }

        public (Guid StationId, DateOnly Date)? SnapshotRequest { get; private set; }

        public IReadOnlyCollection<Guid>? OptionStationIds { get; private set; }

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Actor);
        }

        public Task<DateOnly?> GetLatestOperationDateAsync(
            Guid stationId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            LatestDateStationId = stationId;
            return Task.FromResult(LatestDate);
        }

        public Task<OccPlanningSnapshotData?> GetSnapshotAsync(
            Guid stationId,
            DateOnly operationDate,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            SnapshotRequest = (stationId, operationDate);
            return Task.FromResult(Snapshot);
        }

        public Task<string?> GetStationTimeZoneAsync(
            Guid stationId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<string?>("America/Santo_Domingo");
        }

        public Task<OccPlanningOptionsReadResult> GetOptionsAsync(
            IReadOnlyCollection<Guid> allowedStationIds,
            Guid turnaroundId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            OptionStationIds = allowedStationIds;
            return Task.FromResult(Options is null
                ? OccPlanningOptionsReadResult.Failed(
                    OptionsFailure ?? OccPlanningOptionsReadFailure.NotFound)
                : OccPlanningOptionsReadResult.Success(Options));
        }
    }
}
