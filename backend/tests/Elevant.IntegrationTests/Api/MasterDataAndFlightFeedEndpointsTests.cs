using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 2, block C: the master-data commands require their Idempotency-Key, answer 201 or the replay and fail
/// with Spanish, coded Problem Details (2-A); the flight feed review takes its view, the import its optional key
/// and fields, the restore its required key, the dismissal and the coverage stand attributes their optional key and
/// version, and a refused stand carries its rules (2-A, 2-B, 2-N16, 2-N36).
/// </summary>
public sealed class MasterDataAndFlightFeedEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000007");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid StandId = Guid.Parse("20000000-0000-7000-8000-000000000005");

    [Fact]
    public async Task StationCommandsNeedTheirKeyAndAnswerCodedProblems()
    {
        var store = new StationStub();
        await using var application = Application(services => Replace<IStationCatalogStore>(services, store));
        using var client = Authorized(application);
        var body = new { code = "SDQ", name = "AVIAM SDQ", ianaTimeZone = "America/Santo_Domingo" };

        using var missing = await client.PostAsJsonAsync("/api/v1/governance/stations", body, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastKey);

        var key = Guid.NewGuid();
        using var created = await SendAsync(client, HttpMethod.Post, "governance/stations", key, body);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal((key, "SDQ"), (store.LastKey, store.LastCreate!.Code));
        using var answer = JsonDocument.Parse(await created.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(["id", "code", "name", "ianaTimeZone", "isActive", "hasHistory", "airport", "version"],
            answer.RootElement.EnumerateObject().Select(item => item.Name).ToArray());
        store.Result = store.Result with { Replayed = true };
        using var replayed = await SendAsync(client, HttpMethod.Post, "governance/stations", key, body);
        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);

        foreach (var (failure, code, status) in new[]
        {
            (MasterDataFailure.Conflict, "station_code_taken", HttpStatusCode.Conflict),
            (MasterDataFailure.Conflict, "station_in_use", HttpStatusCode.Conflict),
            (MasterDataFailure.Invalid, "invalid_time_zone", HttpStatusCode.BadRequest),
            (MasterDataFailure.Forbidden, "forbidden", HttpStatusCode.Forbidden),
            (MasterDataFailure.NotFound, "not_found", HttpStatusCode.NotFound),
        })
        {
            store.Result = MasterDataResult<StationCatalogItemData>.Failed(failure, code);
            using var refused = await SendAsync(client, HttpMethod.Put, $"governance/stations/{StationId}", Guid.NewGuid(),
                new { name = "AVIAM SDQ", ianaTimeZone = "America/Santo_Domingo", isActive = false, expectedVersion = "AAAAAAAAB9E=" });
            Assert.Equal(status, refused.StatusCode);
            var problem = await ProblemAsync(refused);
            Assert.Equal(code, problem.Code);
            Assert.DoesNotContain("The ", problem.Title, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task OccMasterDataPassesTheStationAndTheKeyOfEachCommand()
    {
        var store = new MasterDataStub();
        await using var application = Application(services => Replace<IOccMasterDataStore>(services, store));
        using var client = Authorized(application);

        using var read = await client.GetAsync($"/api/v1/occ/master-data?stationId={StationId}", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal(StationId, store.LastStation);

        var stand = new { terminalId = Guid.NewGuid(), code = "A01", hasBoardingBridge = false, isRemote = false,
            maxAircraftSize = (string?)null, isActive = false, expectedVersion = "AAAAAAAAB9E=" };
        using var missing = await client.PutAsJsonAsync($"/api/v1/occ/stands/{StandId}", stand, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        store.StandResult = MasterDataResult<MasterStandData>.Failed(MasterDataFailure.Conflict, "stand_in_use");
        var key = Guid.NewGuid();
        using var inUse = await SendAsync(client, HttpMethod.Put, $"occ/stands/{StandId}", key, stand);
        Assert.Equal((HttpStatusCode.Conflict, "stand_in_use"), (inUse.StatusCode, (await ProblemAsync(inUse)).Code));
        Assert.Equal(key, store.LastKey);

        using var type = await SendAsync(client, HttpMethod.Post, "occ/aircraft-types", Guid.NewGuid(),
            new { icaoCode = "B738", iataCode = "73H", manufacturer = "Boeing", model = "737-800", sizeCategory = "Narrowbody" });
        Assert.Equal(HttpStatusCode.Created, type.StatusCode);
        using var answer = JsonDocument.Parse(await type.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(["id", "icaoCode", "iataCode", "manufacturer", "model", "sizeCategory", "isActive", "version"],
            answer.RootElement.EnumerateObject().Select(item => item.Name).ToArray());
    }

    [Fact]
    public async Task TheFeedReviewTakesItsViewTheImportItsFieldsAndTheRestoreItsKey()
    {
        var store = new FeedStub();
        await using var application = Application(services => Replace<IOccFlightFeedStore>(services, store));
        using var client = Authorized(application);

        using var charter = await client.GetAsync($"/api/v1/occ/flight-feed?stationId={StationId}&date=2026-11-06&view=Charter",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, charter.StatusCode);
        Assert.Equal(OccFlightFeedView.Charter, store.LastView);
        using var invalid = await client.GetAsync($"/api/v1/occ/flight-feed?stationId={StationId}&date=2026-11-06&view=Other",
            TestContext.Current.CancellationToken);
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_flight_feed_query"),
            (invalid.StatusCode, (await ProblemAsync(invalid)).Code));
        // The number of a view is never accepted for its name.
        using var numeric = await client.GetAsync($"/api/v1/occ/flight-feed?stationId={StationId}&date=2026-11-06&view=1",
            TestContext.Current.CancellationToken);
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_flight_feed_query"),
            (numeric.StatusCode, (await ProblemAsync(numeric)).Code));

        var arrival = Guid.NewGuid();
        var departure = Guid.NewGuid();
        using var legacy = await client.PostAsJsonAsync("/api/v1/occ/flight-feed/turnarounds",
            new { arrivalProposalId = arrival, departureProposalId = departure }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Equal((new OccFlightImportInput(arrival, departure), (Guid?)null), (store.LastImport, store.LastImportKey));

        var key = Guid.NewGuid();
        store.ImportResult = new OccFlightImportResult(null, null, OccFlightFeedFailure.Conflict, false, "stand_unavailable",
            ["stand_taken"]);
        using var taken = await SendAsync(client, HttpMethod.Post, "occ/flight-feed/turnarounds", key, new
        {
            arrivalProposalId = arrival, departureProposalId = departure, aircraftTypeId = Guid.NewGuid(),
            standId = StandId, charter = true, expectedArrivalVersion = "AAAAAAAAB9E=", expectedDepartureVersion = "AAAAAAAAB9F=",
        });
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
        Assert.Equal((key, StandId, true, "AAAAAAAAB9F="), (store.LastImportKey, store.LastImport!.StandId, store.LastImport.Charter,
            store.LastImport.ExpectedDepartureVersion));
        using (var problem = JsonDocument.Parse(await taken.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)))
        {
            Assert.Equal("stand_unavailable", problem.RootElement.GetProperty("code").GetString());
            Assert.Equal("stand_taken", problem.RootElement.GetProperty("reasons")[0].GetString());
        }
        using var unknownField = await SendAsync(client, HttpMethod.Post, "occ/flight-feed/turnarounds", Guid.NewGuid(),
            new { arrivalProposalId = arrival, departureProposalId = departure, gate = "22" });
        Assert.Equal(HttpStatusCode.BadRequest, unknownField.StatusCode);

        var proposal = Guid.NewGuid();
        using var restoreWithoutKey = await client.PostAsJsonAsync($"/api/v1/occ/flight-feed/proposals/{proposal}/restore",
            new { expectedVersion = "AAAAAAAAB9E=" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, restoreWithoutKey.StatusCode);
        var restoreKey = Guid.NewGuid();
        using var restored = await SendAsync(client, HttpMethod.Post, $"occ/flight-feed/proposals/{proposal}/restore", restoreKey,
            new { expectedVersion = "AAAAAAAAB9E=" });
        Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        Assert.Equal((proposal, "AAAAAAAAB9E=", restoreKey), store.LastRestore);
        using (var answer = JsonDocument.Parse(await restored.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)))
            Assert.Equal(["proposalId", "status", "version", "replayed"],
                answer.RootElement.EnumerateObject().Select(item => item.Name).ToArray());
        store.RestoreResult = new OccFlightProposalRestoreResult(null, null, OccFlightFeedFailure.Conflict, "flight_proposal_passed");
        using var passed = await SendAsync(client, HttpMethod.Post, $"occ/flight-feed/proposals/{proposal}/restore", Guid.NewGuid(),
            new { expectedVersion = "AAAAAAAAB9E=" });
        var passedProblem = await ProblemAsync(passed);
        Assert.Equal((HttpStatusCode.Conflict, "flight_proposal_passed"), (passed.StatusCode, passedProblem.Code));
        Assert.DoesNotContain("The ", passedProblem.Title, StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheDismissalKeepsItsOlderCallAndTakesTheVersionWithItsKey()
    {
        var store = new FeedStub();
        await using var application = Application(services => Replace<IOccFlightFeedStore>(services, store));
        using var client = Authorized(application);
        var proposal = Guid.NewGuid();
        var path = $"occ/flight-feed/proposals/{proposal}/dismiss";

        // Older screens send no body and no key (expand).
        using var legacy = await client.PostAsync($"/api/v1/{path}", null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, legacy.StatusCode);
        Assert.Equal((proposal, (string?)null, (Guid?)null), store.LastDismiss);

        var key = Guid.NewGuid();
        using var keyed = await SendAsync(client, HttpMethod.Post, path, key, new { expectedVersion = "AAAAAAAAB9E=" });
        Assert.Equal(HttpStatusCode.NoContent, keyed.StatusCode);
        Assert.Equal((proposal, "AAAAAAAAB9E=", (Guid?)key), store.LastDismiss);
        using var unknownField = await SendAsync(client, HttpMethod.Post, path, Guid.NewGuid(),
            new { expectedVersion = "AAAAAAAAB9E=", reason = "duplicate" });
        Assert.Equal(HttpStatusCode.BadRequest, unknownField.StatusCode);
        using var badKey = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/{path}")
            { Content = JsonContent.Create(new { expectedVersion = "AAAAAAAAB9E=" }) };
        badKey.Headers.Add("Idempotency-Key", "not-a-key");
        using var badKeyAnswer = await client.SendAsync(badKey, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, badKeyAnswer.StatusCode);

        foreach (var (result, status, code) in new[]
        {
            (new OccFlightProposalDismissResult(OccFlightFeedFailure.Conflict, "version_conflict"), HttpStatusCode.Conflict,
                "version_conflict"),
            (new OccFlightProposalDismissResult(OccFlightFeedFailure.Conflict, "idempotency_conflict"), HttpStatusCode.Conflict,
                "idempotency_conflict"),
            (new OccFlightProposalDismissResult(OccFlightFeedFailure.Invalid, "expected_version_required"),
                HttpStatusCode.BadRequest, "expected_version_required"),
            // A failure without its own code keeps the code older screens know.
            (new OccFlightProposalDismissResult(OccFlightFeedFailure.Conflict), HttpStatusCode.Conflict, "flight_proposal_closed"),
        })
        {
            store.DismissResult = result;
            using var refused = await SendAsync(client, HttpMethod.Post, path, Guid.NewGuid(), new { expectedVersion = "AAAAAAAAB9E=" });
            var problem = await ProblemAsync(refused);
            Assert.Equal((status, code), (refused.StatusCode, problem.Code));
            Assert.DoesNotContain("The ", problem.Title, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task TheCoverageStandAttributesTakeTheirOptionalKeyAndVersionAndAnswerCodedProblems()
    {
        var store = new CoverageStub();
        await using var application = Application(services => Replace<IPositionCoverageStore>(services, store));
        using var client = Authorized(application);
        var path = $"occ/stands/{StandId}/attributes";
        var attributes = new { date = "2026-11-06", hasBoardingBridge = true, isRemote = false, maxAircraftSize = "Narrowbody",
            isActive = true };

        // Older screens send neither the key nor the version (expand); the board carries the version of every stand.
        using var legacy = await client.PutAsJsonAsync($"/api/v1/{path}", attributes, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Equal(((Guid?)StandId, (string?)null, (Guid?)null), (store.LastStand, store.LastInput!.ExpectedVersion,
            store.LastKey));
        using (var board = JsonDocument.Parse(await legacy.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)))
            Assert.Equal(["standId", "code", "terminalId", "isActive", "hasBoardingBridge", "isRemote", "maxAircraftSize",
                "coveredBy", "version"], board.RootElement.GetProperty("stands")[0].EnumerateObject().Select(item => item.Name)
                .ToArray());

        var key = Guid.NewGuid();
        using var keyed = await SendAsync(client, HttpMethod.Put, path, key, new
        {
            attributes.date, attributes.hasBoardingBridge, attributes.isRemote, attributes.maxAircraftSize, attributes.isActive,
            expectedVersion = "AAAAAAAAB9E=",
        });
        Assert.Equal(HttpStatusCode.OK, keyed.StatusCode);
        Assert.Equal(((string?)"AAAAAAAAB9E=", (Guid?)key, (DateOnly?)new DateOnly(2026, 11, 6)),
            (store.LastInput!.ExpectedVersion, store.LastKey, store.LastDate));

        foreach (var (result, status, code) in new[]
        {
            (CoverageResult.Fail(PositionCoverageFailure.Conflict, null, "version_conflict"), HttpStatusCode.Conflict,
                "version_conflict"),
            (CoverageResult.Fail(PositionCoverageFailure.Conflict, null, "idempotency_conflict"), HttpStatusCode.Conflict,
                "idempotency_conflict"),
            (CoverageResult.Fail(PositionCoverageFailure.Invalid, null, "expected_version_required"), HttpStatusCode.BadRequest,
                "expected_version_required"),
            (CoverageResult.Fail(PositionCoverageFailure.Rejected, ["terminal_inactive"], "terminal_inactive"),
                (HttpStatusCode)422, "terminal_inactive"),
        })
        {
            store.Result = result;
            using var refused = await SendAsync(client, HttpMethod.Put, path, Guid.NewGuid(), new
            {
                attributes.date, attributes.hasBoardingBridge, attributes.isRemote, attributes.maxAircraftSize,
                attributes.isActive, expectedVersion = "AAAAAAAAB9E=",
            });
            Assert.Equal((status, code), (refused.StatusCode, (await ProblemAsync(refused)).Code));
        }
        using var last = await SendAsync(client, HttpMethod.Put, path, Guid.NewGuid(), attributes);
        using (var rejected = JsonDocument.Parse(await last.Content.ReadAsStringAsync(TestContext.Current.CancellationToken)))
            Assert.Equal("terminal_inactive", rejected.RootElement.GetProperty("reasons")[0].GetString());
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string path, Guid key, object body)
    {
        using var request = new HttpRequestMessage(method, $"/api/v1/{path}") { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<(string? Code, string Title)> ProblemAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        return (problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null,
            problem.RootElement.GetProperty("title").GetString() ?? string.Empty);
    }

    private static void Replace<T>(IServiceCollection services, T implementation) where T : class
    {
        services.RemoveAll<T>();
        services.AddSingleton(implementation);
    }

    private WebApplicationFactory<Program> Application(Action<IServiceCollection> configure) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(configure));

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(
                        ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static StationCatalogItemData Station() => new(StationId, "SDQ", "AVIAM SDQ", "America/Santo_Domingo", true, false,
        new StationAirportData(Guid.NewGuid(), "SDQ", "MDSD", "Las Américas", "Santo Domingo", "DO"), "AAAAAAAAB9E=");

    private sealed class StationStub : IStationCatalogStore
    {
        public MasterDataResult<StationCatalogItemData> Result { get; set; } = MasterDataResult<StationCatalogItemData>.Success(Station());
        public Guid? LastKey { get; private set; }
        public CreateStationInput? LastCreate { get; private set; }

        public Task<StationCatalogData?> ListAsync(Guid actorId, CancellationToken cancellationToken = default) =>
            Task.FromResult<StationCatalogData?>(new StationCatalogData([Station()], []));

        public Task<MasterDataResult<StationCatalogItemData>> CreateAsync(Guid actorId, CreateStationInput input, Guid idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            (LastKey, LastCreate) = (idempotencyKey, input);
            return Task.FromResult(Result);
        }

        public Task<MasterDataResult<StationCatalogItemData>> UpdateAsync(Guid actorId, Guid stationId, UpdateStationInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastKey = idempotencyKey;
            return Task.FromResult(Result);
        }
    }

    private sealed class MasterDataStub : IOccMasterDataStore
    {
        public MasterDataResult<MasterStandData> StandResult { get; set; } = MasterDataResult<MasterStandData>.Success(
            new MasterStandData(StandId, Guid.NewGuid(), "A01", false, false, null, true, false, "AAAAAAAAB9E="));
        public Guid? LastStation { get; private set; }
        public Guid? LastKey { get; private set; }

        public Task<MasterDataResult<OccMasterData>> ReadAsync(Guid actorId, Guid stationId,
            CancellationToken cancellationToken = default)
        {
            LastStation = stationId;
            return Task.FromResult(MasterDataResult<OccMasterData>.Success(new OccMasterData(stationId, "PUJ", [], [], [], true, true)));
        }

        public Task<MasterDataResult<MasterTerminalData>> CreateTerminalAsync(Guid actorId, CreateTerminalInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<MasterDataResult<MasterTerminalData>> UpdateTerminalAsync(Guid actorId, Guid terminalId,
            UpdateTerminalInput input, Guid idempotencyKey, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<MasterDataResult<MasterStandData>> CreateStandAsync(Guid actorId, CreateStandInput input, Guid idempotencyKey,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<MasterDataResult<MasterStandData>> UpdateStandAsync(Guid actorId, Guid standId, UpdateStandInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastKey = idempotencyKey;
            return Task.FromResult(StandResult);
        }

        public Task<MasterDataResult<MasterAircraftTypeData>> CreateAircraftTypeAsync(Guid actorId, CreateAircraftTypeInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default) =>
            Task.FromResult(MasterDataResult<MasterAircraftTypeData>.Success(new MasterAircraftTypeData(Guid.NewGuid(), input.IcaoCode,
                input.IataCode, input.Manufacturer, input.Model, input.SizeCategory, true, "AAAAAAAAB9E=")));

        public Task<MasterDataResult<MasterAircraftTypeData>> UpdateAircraftTypeAsync(Guid actorId, Guid aircraftTypeId,
            UpdateAircraftTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class FeedStub : IOccFlightFeedStore
    {
        public OccFlightImportResult ImportResult { get; set; } = new(Guid.NewGuid(), "EXT-1", null);
        public OccFlightProposalRestoreResult RestoreResult { get; set; } = new(Guid.NewGuid(), "AAAAAAAAB9G=", null);
        public OccFlightFeedView? LastView { get; private set; }
        public OccFlightImportInput? LastImport { get; private set; }
        public Guid? LastImportKey { get; private set; }
        public (Guid, string?, Guid)? LastRestore { get; private set; }

        public Task<OccFlightFeedData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
            OccFlightFeedView view = OccFlightFeedView.Contracted, CancellationToken cancellationToken = default)
        {
            LastView = view;
            return Task.FromResult<OccFlightFeedData?>(new OccFlightFeedData(stationId, "PUJ", date,
                new OccFlightFeedBudgetData(true, "Simulated", 2, 1200, 2, 38000, null, null), null, null, true, []));
        }

        public Task<OccFlightImportResult> ImportAsync(Guid actorId, OccFlightImportInput input, Guid? idempotencyKey,
            CancellationToken cancellationToken = default)
        {
            (LastImport, LastImportKey) = (input, idempotencyKey);
            return Task.FromResult(ImportResult);
        }

        public OccFlightProposalDismissResult DismissResult { get; set; } = new(null);
        public (Guid, string?, Guid?)? LastDismiss { get; private set; }

        public Task<OccFlightProposalDismissResult> DismissAsync(Guid actorId, Guid proposalId, string? expectedVersion = null,
            Guid? idempotencyKey = null, CancellationToken cancellationToken = default)
        {
            LastDismiss = (proposalId, expectedVersion, idempotencyKey);
            return Task.FromResult(DismissResult);
        }

        public Task<OccFlightProposalRestoreResult> RestoreAsync(Guid actorId, Guid proposalId, string? expectedVersion,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastRestore = (proposalId, expectedVersion, idempotencyKey);
            return Task.FromResult(RestoreResult with { ProposalId = RestoreResult.ProposalId is null ? null : proposalId });
        }
    }

    private sealed class CoverageStub : IPositionCoverageStore
    {
        public CoverageResult? Result { get; set; }
        public Guid? LastStand { get; private set; }
        public StandAttributesInput? LastInput { get; private set; }
        public DateOnly? LastDate { get; private set; }
        public Guid? LastKey { get; private set; }

        public Task<CoverageResult> UpdateStandAsync(Guid actorId, Guid standId, StandAttributesInput input, DateOnly date,
            Guid? idempotencyKey = null, CancellationToken cancellationToken = default)
        {
            (LastStand, LastInput, LastDate, LastKey) = (standId, input, date, idempotencyKey);
            return Task.FromResult(Result ?? new CoverageResult(new CoverageBoardData(StationId, "PUJ", date, [],
                [new CoverageStandData(standId, "A01", null, input.IsActive, input.HasBoardingBridge, input.IsRemote,
                    input.MaxAircraftSize, [], "AAAAAAAAB9F=")], [], [], [], true, true), null, []));
        }

        public Task<CoverageResult> ReadAsync(Guid actorId, Guid stationId, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> CreateAsync(Guid actorId, Guid stationId, CreateCoverageInput input,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> ReleaseAsync(Guid actorId, Guid coverageId, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> UpdateTerminalAsync(Guid actorId, Guid terminalId, TerminalRulesInput input, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> AddConstraintAsync(Guid actorId, StandConstraintInput input, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<CoverageResult> RemoveConstraintAsync(Guid actorId, Guid constraintId, DateOnly date,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<PositionCoverageFailure?> ReleaseOperationAgentAsync(Guid actorId, Guid turnaroundId,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<IReadOnlyList<OwnCoverageData>?> ReadOwnAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }
}
