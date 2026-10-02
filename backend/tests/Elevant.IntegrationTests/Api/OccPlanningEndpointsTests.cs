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

public sealed class OccPlanningEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid SecondStationId = Guid.Parse("20000000-0000-7000-8000-000000000013");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
    private static readonly Guid AgentId = Guid.Parse("50000000-0000-7000-8000-000000000001");
    private static readonly DateOnly FixtureDate = new(2026, 8, 19);
    private static readonly byte[] ContextVersion =
        Enumerable.Range(1, 32).Select(value => (byte)value).ToArray();
    private static readonly Guid ReceiptId =
        Guid.Parse("90000000-0000-7000-8000-000000000002");

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

        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"/api/v1/occ/planning/options?turnaroundId={TurnaroundId:D}");
        request.Headers.Add("Origin", ElevantApiFactory.PrivateWebOrigin);
        using var response = await client.SendAsync(
            request,
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
        Assert.Equal(
            $"\"{Convert.ToBase64String(ContextVersion)}\"",
            response.Headers.ETag?.Tag);
        Assert.Contains(
            "ETag",
            response.Headers.GetValues("Access-Control-Expose-Headers"),
            StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("operationVersion", document.RootElement.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task AssignmentRequiresBearerAuthentication()
    {
        await using var application = CreateApplication(new OccState());
        using var client = application.CreateClient();
        using var request = CreateAssignmentRequest(includeIfMatch: true);

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task AssignmentRequiresAValidStrongIfMatch()
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            AssignmentWriteResult = OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var missing = CreateAssignmentRequest(includeIfMatch: false);
        using var weak = CreateAssignmentRequest(includeIfMatch: false);
        weak.Headers.TryAddWithoutValidation(
            "If-Match",
            $"W/\"{Convert.ToBase64String(ContextVersion)}\"");
        using var malformed = CreateAssignmentRequest(includeIfMatch: false);
        malformed.Headers.TryAddWithoutValidation("If-Match", "\"not-base64\"");

        using var missingResponse = await client.SendAsync(
            missing,
            TestContext.Current.CancellationToken);
        using var weakResponse = await client.SendAsync(
            weak,
            TestContext.Current.CancellationToken);
        using var malformedResponse = await client.SendAsync(
            malformed,
            TestContext.Current.CancellationToken);

        Assert.Equal((HttpStatusCode)428, missingResponse.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, weakResponse.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformedResponse.StatusCode);
        AssertPrivateResponse(missingResponse);
        AssertPrivateResponse(weakResponse);
        AssertPrivateResponse(malformedResponse);
        Assert.Null(state.AssignmentRequest);
    }

    [Fact]
    public async Task AssignmentAcceptsOnlyAgentAndReturnsCanonicalResultWithNewEtag()
    {
        var assignment = CreateAssignment();
        var state = new OccState
        {
            Actor = CreateActor(),
            AssignmentWriteResult = OccAssignmentWriteResult.Success(assignment, ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateAssignmentRequest(includeIfMatch: true);

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal($"\"{assignment.ConcurrencyToken}\"", response.Headers.ETag?.Tag);
        Assert.NotNull(state.AssignmentRequest);
        Assert.Equal(AccountId, state.AssignmentRequest.ActorAccountId);
        Assert.Equal([StationId], state.AssignmentRequest.AllowedStationIds);
        Assert.Equal(TurnaroundId, state.AssignmentRequest.TurnaroundId);
        Assert.Equal(AgentId, state.AssignmentRequest.AgentId);
        Assert.Equal(ContextVersion, state.AssignmentRequest.ExpectedContextVersion);
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal("Assigned", document.RootElement.GetProperty("operation").GetProperty("status").GetString());
        Assert.Equal(AgentId, document.RootElement.GetProperty("assignment").GetProperty("agentId").GetGuid());
        Assert.False(document.RootElement.TryGetProperty("operationVersion", out _));
    }

    [Theory]
    [InlineData(OccAssignmentWriteFailure.NotFound, HttpStatusCode.NotFound)]
    [InlineData(OccAssignmentWriteFailure.Conflict, HttpStatusCode.Conflict)]
    [InlineData(OccAssignmentWriteFailure.PreconditionFailed, HttpStatusCode.PreconditionFailed)]
    public async Task AssignmentMapsStoreFailuresToStableHttpResponses(
        OccAssignmentWriteFailure failure,
        HttpStatusCode expectedStatus)
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            AssignmentWriteResult = OccAssignmentWriteResult.Failed(failure),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateAssignmentRequest(includeIfMatch: true);

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(expectedStatus, response.StatusCode);
        AssertPrivateResponse(response);
    }

    [Fact]
    public async Task AssignmentRejectsUnknownJsonMembers()
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            AssignmentWriteResult = OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/assignment")
        {
            Content = new StringContent(
                $$"""{"agentId":"{{AgentId:D}}","serviceIds":[]}""",
                System.Text.Encoding.UTF8,
                "application/json"),
        };
        request.Headers.TryAddWithoutValidation(
            "If-Match",
            $"\"{Convert.ToBase64String(ContextVersion)}\"");

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Null(state.AssignmentRequest);
    }

    [Fact]
    public async Task AssignmentRejectsMissingBodyBeforeCallingTheStore()
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            AssignmentWriteResult = OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/assignment");
        request.Headers.TryAddWithoutValidation(
            "If-Match",
            $"\"{Convert.ToBase64String(ContextVersion)}\"");

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Null(state.AssignmentRequest);
    }

    [Fact]
    public async Task OversizedAssignmentBodyIsRejectedBeforeCallingTheStore()
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            AssignmentWriteResult = OccAssignmentWriteResult.Success(CreateAssignment(), ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/assignment")
        {
            Content = new StringContent(
                $$"""{"agentId":"{{AgentId:D}}","padding":"{{new string('x', 1500)}}"}""",
                System.Text.Encoding.UTF8,
                "application/json"),
        };
        request.Headers.TryAddWithoutValidation(
            "If-Match",
            $"\"{Convert.ToBase64String(ContextVersion)}\"");
        request.Headers.Add("Origin", ElevantApiFactory.PrivateWebOrigin);

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal(
            ElevantApiFactory.PrivateWebOrigin,
            response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal(
            "true",
            response.Headers.GetValues("Access-Control-Allow-Credentials").Single());
        Assert.Null(state.AssignmentRequest);
    }

    [Theory]
    [InlineData(OccPlanningOptionsReadFailure.ContractConflict)]
    [InlineData(OccPlanningOptionsReadFailure.OperationalConflict)]
    public async Task InvalidPlanningContextsReturnGenericConflict(
        OccPlanningOptionsReadFailure failure)
    {
        var state = new OccState
        {
            Actor = CreateActor(),
            OptionsFailure = failure,
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
    public async Task OpenApiPublishesAllOccPlanningOperations()
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
        Assert.True(paths.TryGetProperty("/api/v1/occ/planning/manual-options", out var manualOptions));
        Assert.True(manualOptions.TryGetProperty("get", out _));
        Assert.True(paths.TryGetProperty("/api/v1/occ/planning/turnarounds", out var manualTurnaround));
        Assert.True(manualTurnaround.TryGetProperty("post", out var createManual));
        Assert.True(createManual.GetProperty("responses").TryGetProperty("201", out _));
        Assert.True(createManual.GetProperty("responses").TryGetProperty("409", out _));
        var shiftPath = document.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/occ/planning/turnarounds/{turnaroundId}/shift");
        Assert.True(shiftPath.GetProperty("post").GetProperty("responses")
            .TryGetProperty("201", out _));
        Assert.True(paths.TryGetProperty("/api/v1/occ/planning/options", out var options));
        Assert.True(options.TryGetProperty("get", out var optionsGet));
        Assert.True(optionsGet.GetProperty("responses").TryGetProperty("409", out _));
        Assert.True(optionsGet
            .GetProperty("responses")
            .GetProperty("200")
            .GetProperty("headers")
            .TryGetProperty("ETag", out _));
        Assert.True(paths.TryGetProperty(
            "/api/v1/occ/planning/turnarounds/{turnaroundId}/assignment",
            out var assignment));
        Assert.True(assignment.TryGetProperty("post", out var assignmentPost));
        var assignmentResponses = assignmentPost.GetProperty("responses");
        foreach (var responseCode in new[] { "200", "400", "401", "403", "404", "409", "412", "413", "415", "428", "429", "500" })
        {
            Assert.True(assignmentResponses.TryGetProperty(responseCode, out _), responseCode);
        }

        var parameters = assignmentPost.GetProperty("parameters").EnumerateArray().ToArray();
        var ifMatch = Assert.Single(parameters, parameter =>
            parameter.GetProperty("name").GetString() == "If-Match");
        Assert.Equal("header", ifMatch.GetProperty("in").GetString());
        Assert.True(ifMatch.GetProperty("required").GetBoolean());
        Assert.True(assignmentResponses
            .GetProperty("200")
            .GetProperty("headers")
            .TryGetProperty("ETag", out _));
        var requestSchema = assignmentPost
            .GetProperty("requestBody")
            .GetProperty("content")
            .GetProperty("application/json")
            .GetProperty("schema");
        var requestReference = requestSchema.TryGetProperty("$ref", out var directReference)
            ? directReference
            : Assert.Single(requestSchema.GetProperty("allOf").EnumerateArray())
                .GetProperty("$ref");
        Assert.Equal("#/components/schemas/AssignOccOperationRequest", requestReference.GetString());
        Assert.True(assignmentPost.GetProperty("requestBody").GetProperty("required").GetBoolean());

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
        var assignmentRequest = schemas.GetProperty("AssignOccOperationRequest");
        Assert.Equal(
            ["agentId"],
            assignmentRequest.GetProperty("properties").EnumerateObject().Select(item => item.Name));
        Assert.False(assignmentRequest.GetProperty("additionalProperties").GetBoolean());
    }

    [Fact]
    public async Task ManualTurnaroundOptionsAndCreateUseScopedContracts()
    {
        var airlineId = Guid.NewGuid();
        var state = new OccState
        {
            Actor = CreateActor(),
            ManualOptions = new ManualTurnaroundOptionsData(
                CreateStation(), FixtureDate,
                new OccAirportData(Guid.NewGuid(), "PUJ", "MDPC", "Punta Cana"),
                [new ManualTurnaroundAirlineData(airlineId, "EV", "Elevant Demo")],
                [new OccAirportData(Guid.NewGuid(), "MIA", "KMIA", "Miami")],
                [new OccStandData(Guid.NewGuid(), "A01", new OccTerminalData(Guid.NewGuid(), "A", "Terminal A"))]),
            ManualWriteResult = ManualTurnaroundWriteResult.Created(TurnaroundId, "MAN-TEST"),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var options = await client.GetAsync(
            $"/api/v1/occ/planning/manual-options?stationId={StationId:D}&date=2026-08-19",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, options.StatusCode);
        AssertPrivateResponse(options);
        using var optionsJson = JsonDocument.Parse(await options.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(airlineId, optionsJson.RootElement.GetProperty("airlines")[0]
            .GetProperty("id").GetGuid());

        using var response = await client.PostAsJsonAsync(
            "/api/v1/occ/planning/turnarounds",
            new
            {
                turnaroundId = TurnaroundId,
                stationId = StationId,
                airlineId,
                standId = state.ManualOptions.Stands[0].Id,
                operationDate = "2026-08-19",
                arrivalFlightNumber = "EV 311",
                arrivalOriginIata = "MIA",
                arrivalScheduledAt = "2026-08-19T13:00:00Z",
                departureFlightNumber = "EV 312",
                departureDestinationIata = "MIA",
                departureScheduledAt = "2026-08-19T15:00:00Z",
            }, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("EV311", state.ManualRequest!.ArrivalFlightNumber);
        Assert.Equal([StationId], state.ManualRequest.AllowedStationIds);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(TurnaroundId, json.RootElement.GetProperty("turnaroundId").GetGuid());
        Assert.False(json.RootElement.GetProperty("replayed").GetBoolean());
    }

    [Fact]
    public async Task ManualTurnaroundRejectsUnknownJsonAndOutOfScopeStation()
    {
        var state = new OccState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var unknown = await client.PostAsJsonAsync(
            "/api/v1/occ/planning/turnarounds", new { turnaroundId = TurnaroundId, extra = true },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Null(state.ManualRequest);

        using var outOfScope = await client.GetAsync(
            $"/api/v1/occ/planning/manual-options?stationId={Guid.NewGuid():D}&date=2026-08-19",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, outOfScope.StatusCode);
        Assert.Null(state.ManualOptionsRequest);
    }

    [Fact]
    public async Task ShiftProgrammingUsesScopedBodyAndPrivateResponse()
    {
        var shiftId = Guid.NewGuid();
        var state = new OccState
        {
            Actor = CreateActor(),
            ShiftWriteResult = OccShiftWriteResult.Created(shiftId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.PostAsJsonAsync(
            $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/shift",
            new { agentId = AgentId, startsAtLocal = "08:00:00", endsAtLocal = "12:00:00" },
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal([StationId], state.ShiftRequest!.AllowedStationIds);
        Assert.Equal(AgentId, state.ShiftRequest.AgentId);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(shiftId, json.RootElement.GetProperty("shiftId").GetGuid());
        Assert.False(json.RootElement.GetProperty("replayed").GetBoolean());
    }

    [Fact]
    public async Task ShiftProgrammingRejectsUnknownBodyMembers()
    {
        var state = new OccState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var response = await client.PostAsJsonAsync(
            $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/shift",
            new { agentId = AgentId, startsAtLocal = "08:00:00", endsAtLocal = "12:00:00", stationId = Guid.NewGuid() },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.ShiftRequest);
    }

    private WebApplicationFactory<Program> CreateApplication(OccState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IOccPlanningReadStore>();
            services.RemoveAll<IOccPlanningCommandStore>();
            services.RemoveAll<IManualTurnaroundStore>();
            services.RemoveAll<IManualTurnaroundOptionsStore>();
            services.RemoveAll<IOccShiftProgrammingStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IOccPlanningReadStore>(_ => state);
            services.AddScoped<IOccPlanningCommandStore>(_ => state);
            services.AddScoped<IManualTurnaroundStore>(_ => state);
            services.AddScoped<IManualTurnaroundOptionsStore>(_ => state);
            services.AddScoped<IOccShiftProgrammingStore>(_ => state);
        }));

    private static HttpRequestMessage CreateAssignmentRequest(bool includeIfMatch)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/occ/planning/turnarounds/{TurnaroundId:D}/assignment")
        {
            Content = JsonContent.Create(new { agentId = AgentId }),
        };
        if (includeIfMatch)
        {
            request.Headers.TryAddWithoutValidation(
                "If-Match",
                $"\"{Convert.ToBase64String(ContextVersion)}\"");
        }

        return request;
    }

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
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType, Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
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
            new DateTimeOffset(2026, 8, 19, 12, 15, 0, TimeSpan.Zero),
            Convert.ToBase64String(ContextVersion)),
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
                HasCompatibleShift: false,
                OperationalPositionId: null,
                HasAssignmentConflict: false),
        ]);

    private static OccAssignmentData CreateAssignment()
    {
        var start = new DateTimeOffset(2026, 8, 19, 12, 15, 0, TimeSpan.Zero);
        return new OccAssignmentData(
            TurnaroundId,
            new OccGroundOperationData(
                Guid.Parse("70000000-0000-7000-8000-000000000016"),
                "Assigned",
                start,
                start.AddHours(2),
                null,
                null),
            new OccAssignedAgentData(
                Guid.Parse("70000000-0000-7000-8000-000000000018"),
                AgentId,
                "Riley Ramp",
                "DEV-RA-001",
                Guid.Parse("52000000-0000-7000-8000-000000000001"),
                "RAMP-AGENT",
                "Ramp agent",
                "primary",
                start),
            [],
            Convert.ToBase64String(Enumerable.Repeat((byte)8, 32).ToArray()));
    }

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

    private sealed class OccState : IActorContextResolver, IOccPlanningReadStore, IOccPlanningCommandStore,
        IManualTurnaroundStore, IManualTurnaroundOptionsStore, IOccShiftProgrammingStore
    {
        public ActorContext? Actor { get; init; }

        public DateOnly? LatestDate { get; init; }

        public OccPlanningSnapshotData? Snapshot { get; init; }

        public OccPlanningOptionsSourceData? Options { get; init; }

        public OccPlanningOptionsReadFailure? OptionsFailure { get; init; }

        public OccAssignmentWriteResult AssignmentWriteResult { get; init; } =
            OccAssignmentWriteResult.Failed(OccAssignmentWriteFailure.Conflict);

        public Guid? LatestDateStationId { get; private set; }

        public (Guid StationId, DateOnly Date)? SnapshotRequest { get; private set; }

        public IReadOnlyCollection<Guid>? OptionStationIds { get; private set; }

        public OccAssignmentWriteRequest? AssignmentRequest { get; private set; }

        public ManualTurnaroundWriteRequest? ManualRequest { get; private set; }

        public (Guid AccountId, Guid StationId, DateOnly Date)? ManualOptionsRequest { get; private set; }

        public ManualTurnaroundOptionsData? ManualOptions { get; init; }

        public ManualTurnaroundWriteResult ManualWriteResult { get; init; } =
            ManualTurnaroundWriteResult.Failed(ManualTurnaroundWriteFailure.Conflict);

        public OccShiftWriteRequest? ShiftRequest { get; private set; }

        public OccShiftWriteResult ShiftWriteResult { get; init; } =
            OccShiftWriteResult.Failed(OccShiftWriteFailure.Conflict);


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

        public Task<OccAssignmentWriteResult> AssignOperationAsync(
            OccAssignmentWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            AssignmentRequest = request;
            return Task.FromResult(AssignmentWriteResult);
        }

        public Task<ManualTurnaroundWriteResult> CreateAsync(
            ManualTurnaroundWriteRequest request, CancellationToken cancellationToken = default)
        {
            ManualRequest = request;
            return Task.FromResult(ManualWriteResult);
        }

        public Task<ManualTurnaroundOptionsData?> GetAsync(
            Guid accountId, Guid stationId, DateOnly operationDate,
            CancellationToken cancellationToken = default)
        {
            ManualOptionsRequest = (accountId, stationId, operationDate);
            return Task.FromResult(ManualOptions);
        }

        public Task<OccShiftWriteResult> ProgramAsync(
            OccShiftWriteRequest request, CancellationToken cancellationToken = default)
        {
            ShiftRequest = request;
            return Task.FromResult(ShiftWriteResult);
        }

    }
}
