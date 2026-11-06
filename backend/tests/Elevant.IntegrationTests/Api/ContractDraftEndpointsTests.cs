using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Contract drafts, the contract lifecycle and the Finance decision (phase 1, block B): Idempotency-Key
/// and expected version binding (required on new commands, optional on the existing ones) and coded
/// Problem Details for every failure.
/// </summary>
public sealed class ContractDraftEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
    private static readonly Guid VersionId = Guid.Parse("70000000-0000-7000-8000-0000000000c1");
    private const string Version = "AAAAAAAAB9E=";

    [Fact]
    public async Task NewDraftCommandsNeedTheIdempotencyKeyAndPassTheExpectedVersion()
    {
        var store = new DraftStub();
        await using var application = Application(services => Replace<IContractDraftStore>(services, store));
        using var client = Authorized(application);
        var key = Guid.NewGuid();
        var scope = new { expectedVersion = Version, serviceIds = new[] { Guid.NewGuid() }, stationIds = new[] { Guid.NewGuid() } };

        using var missing = await client.PutAsJsonAsync($"/api/v1/contracts/drafts/{VersionId}/scope", scope,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastScope);

        using var scoped = await SendAsync(client, HttpMethod.Put, "scope", key, scope);
        Assert.Equal(HttpStatusCode.OK, scoped.StatusCode);
        Assert.Equal((key, Version), (store.LastScope?.Key, store.LastScope?.Input.ExpectedVersion));
        Assert.Equal(scope.serviceIds, store.LastScope!.Input.ServiceIds);

        using var discarded = await SendAsync(client, HttpMethod.Post, "discard", key,
            new { expectedVersion = Version, reason = "La aerolínea desistió." });
        Assert.Equal(HttpStatusCode.OK, discarded.StatusCode);
        Assert.Equal(new DiscardContractDraftInput(Version, "La aerolínea desistió."), store.LastDiscard);

        using var replied = await SendAsync(client, HttpMethod.Post, "comments", key,
            new { expectedVersion = Version, body = "Confirmamos el horario." });
        Assert.Equal(HttpStatusCode.Created, replied.StatusCode);
        Assert.Equal(new ReplyContractDraftInput(Version, "Confirmamos el horario."), store.LastReply);

        using var noReplyKey = await client.PostAsJsonAsync($"/api/v1/contracts/drafts/{VersionId}/comments",
            new { expectedVersion = Version, body = "Sin clave." }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, noReplyKey.StatusCode);
    }

    [Fact]
    public async Task ExistingDraftCommandsStayUsableWithoutKeyOrBodyAndForwardThemWhenPresent()
    {
        var store = new DraftStub();
        await using var application = Application(services => Replace<IContractDraftStore>(services, store));
        using var client = Authorized(application);
        var key = Guid.NewGuid();
        var update = new
        {
            validFrom = "2027-01-01", validTo = (string?)null, currencyCode = "USD", terms = "Condiciones.",
            rates = new[] { new { id = Guid.NewGuid(), billingUnit = "operation", unitPrice = 100m, minimumQuantity = 1m, isConfirmed = true } },
        };

        using var legacyUpdate = await client.PutAsJsonAsync($"/api/v1/contracts/drafts/{VersionId}", update,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacyUpdate.StatusCode);
        Assert.Null(store.LastUpdate?.Key);
        Assert.Null(store.LastUpdate?.Input.ExpectedVersion);
        using var keyedUpdate = await SendAsync(client, HttpMethod.Put, null, key, new
        {
            update.validFrom, update.validTo, update.currencyCode, update.terms, update.rates, expectedVersion = Version,
        });
        Assert.Equal(HttpStatusCode.OK, keyedUpdate.StatusCode);
        Assert.Equal((key, Version), (store.LastUpdate?.Key, store.LastUpdate?.Input.ExpectedVersion));

        // «Enviar a Finanzas» had no body: an empty POST still works (expand).
        using var legacySubmit = await client.PostAsync($"/api/v1/contracts/drafts/{VersionId}/activate", null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacySubmit.StatusCode);
        Assert.Null(store.LastSubmit?.Input);
        Assert.Null(store.LastSubmit?.Key);
        using var keyedSubmit = await SendAsync(client, HttpMethod.Post, "activate", key, new { expectedVersion = Version });
        Assert.Equal(HttpStatusCode.OK, keyedSubmit.StatusCode);
        Assert.Equal((key, Version), (store.LastSubmit?.Key, store.LastSubmit?.Input?.ExpectedVersion));

        using var legacyComment = await client.PostAsJsonAsync($"/api/v1/airline/contract-drafts/{VersionId}/comments",
            new { body = "¿Pueden confirmar el horario?" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, legacyComment.StatusCode);
        Assert.Null(store.LastComment?.Key);
        Assert.Equal(new AirlineDraftCommentInput("¿Pueden confirmar el horario?"), store.LastComment?.Input);
        using var keyedComment = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/airline/contract-drafts/{VersionId}/comments")
        { Content = JsonContent.Create(new { body = "Otra observación.", expectedVersion = Version }) };
        keyedComment.Headers.Add("Idempotency-Key", key.ToString("D"));
        using var commented = await client.SendAsync(keyedComment, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, commented.StatusCode);
        Assert.Equal((key, Version), (store.LastComment?.Key, store.LastComment?.Input.ExpectedVersion));
    }

    [Fact]
    public async Task EveryDraftFailureIsProblemDetailsWithItsStableCode()
    {
        var store = new DraftStub();
        await using var application = Application(services => Replace<IContractDraftStore>(services, store));
        using var client = Authorized(application);
        foreach (var (result, status, code) in new[]
        {
            (ContractDraftResult.Failed(ContractDraftFailure.Conflict, "portal_account_missing"), HttpStatusCode.Conflict,
                "portal_account_missing"),
            (ContractDraftResult.Failed(ContractDraftFailure.Conflict), HttpStatusCode.Conflict, "version_conflict"),
            (ContractDraftResult.Failed(ContractDraftFailure.NotFound), HttpStatusCode.NotFound, "not_found"),
            (ContractDraftResult.Failed(ContractDraftFailure.Invalid), HttpStatusCode.BadRequest, "invalid_draft"),
            (ContractDraftResult.Failed(ContractDraftFailure.Invalid, "reason_required"), HttpStatusCode.BadRequest,
                "reason_required"),
        })
        {
            store.Result = result;
            using var response = await SendAsync(client, HttpMethod.Post, "activate", Guid.NewGuid(),
                new { expectedVersion = Version });
            Assert.Equal(status, response.StatusCode);
            Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
            Assert.Equal(code, await CodeAsync(response));
        }
        store.Result = ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        using var forbidden = await SendAsync(client, HttpMethod.Post, "discard", Guid.NewGuid(),
            new { expectedVersion = Version, reason = "La aerolínea desistió." });
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);

        store.ReadFailure = ContractDraftFailure.NotFound;
        using var readiness = await client.GetAsync($"/api/v1/contracts/drafts/{VersionId}/readiness",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, readiness.StatusCode);
        Assert.Equal("not_found", await CodeAsync(readiness));
        store.ReadFailure = ContractDraftFailure.Forbidden;
        using var scope = await client.GetAsync($"/api/v1/contracts/drafts/{VersionId}/scope",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, scope.StatusCode);
        store.ReadFailure = null;
        using var ready = await client.GetAsync($"/api/v1/contracts/drafts/{VersionId}/readiness",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
        using var json = JsonDocument.Parse(await ready.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("terms_missing", json.RootElement.GetProperty("issues")[0].GetProperty("code").GetString());
        Assert.Equal("Invited", json.RootElement.GetProperty("portalAccount").GetString());
    }

    [Fact]
    public async Task TheLifecycleForwardsItsOptionalKeyAndCodesEveryFailure()
    {
        var lifecycle = new LifecycleStub();
        await using var application = Application(services => Replace<IContractLifecycleStore>(services, lifecycle));
        using var client = Authorized(application);
        var body = new { action = "Terminate", reason = "La aerolínea desistió.", expectedStatus = "Draft" };
        using var legacy = await client.PostAsJsonAsync($"/api/v1/contract-versions/{VersionId}/lifecycle", body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Null(lifecycle.LastKey);
        var key = Guid.NewGuid();
        using var keyed = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/contract-versions/{VersionId}/lifecycle")
        { Content = JsonContent.Create(body) };
        keyed.Headers.Add("Idempotency-Key", key.ToString("D"));
        using var applied = await client.SendAsync(keyed, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, applied.StatusCode);
        Assert.Equal(key, lifecycle.LastKey);

        foreach (var (result, status, code) in new[]
        {
            (ContractLifecycleResult.Failed(ContractLifecycleFailure.NotFound), HttpStatusCode.NotFound, "not_found"),
            (ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict), HttpStatusCode.Conflict, "status_changed"),
            (ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid), HttpStatusCode.BadRequest,
                "invalid_lifecycle_action"),
            (ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, "idempotency_conflict"),
                HttpStatusCode.Conflict, "idempotency_conflict"),
        })
        {
            lifecycle.Result = result;
            using var response = await client.PostAsJsonAsync($"/api/v1/contract-versions/{VersionId}/lifecycle", body,
                TestContext.Current.CancellationToken);
            Assert.Equal(status, response.StatusCode);
            Assert.Equal(code, await CodeAsync(response));
        }
        using var timeline = await client.GetAsync($"/api/v1/contract-versions/{VersionId}/timeline",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, timeline.StatusCode);
        Assert.Equal("not_found", await CodeAsync(timeline));
    }

    [Fact]
    public async Task TheFinanceDecisionForwardsItsOptionalKeyAndCodesEachBlockingCause()
    {
        var book = new FinanceBookStub();
        await using var application = Application(services => Replace<IFinanceTariffBookStore>(services, book));
        using var client = Authorized(application);
        var body = new { decision = "Approved", reason = (string?)null, expectedVersion = Version };
        using var legacy = await client.PostAsJsonAsync($"/api/v1/finance/contract-approvals/{VersionId}/decision", body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Null(book.LastKey);
        var key = Guid.NewGuid();
        using var keyed = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/finance/contract-approvals/{VersionId}/decision")
        { Content = JsonContent.Create(body) };
        keyed.Headers.Add("Idempotency-Key", key.ToString("D"));
        using var decided = await client.SendAsync(keyed, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, decided.StatusCode);
        Assert.Equal(key, book.LastKey);

        foreach (var (result, status, code) in new[]
        {
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "package_not_eligible"), HttpStatusCode.Conflict,
                "package_not_eligible"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "service_retired"), HttpStatusCode.Conflict,
                "service_retired"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict), HttpStatusCode.Conflict, "version_conflict"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound), HttpStatusCode.NotFound, "not_found"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid), HttpStatusCode.BadRequest, "invalid_contract_decision"),
        })
        {
            book.Result = result;
            using var response = await client.PostAsJsonAsync($"/api/v1/finance/contract-approvals/{VersionId}/decision",
                body, TestContext.Current.CancellationToken);
            Assert.Equal(status, response.StatusCode);
            Assert.Equal(code, await CodeAsync(response));
        }
    }

    [Fact]
    public async Task PublishesTheDraftOperations()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        var paths = document.RootElement.GetProperty("paths");
        foreach (var (path, method, operation) in new[]
        {
            ("/api/v1/contracts/drafts/{versionId}/readiness", "get", "GetManagedContractDraftReadiness"),
            ("/api/v1/contracts/drafts/{versionId}/scope", "get", "GetManagedContractDraftScope"),
            ("/api/v1/contracts/drafts/{versionId}/scope", "put", "SetManagedContractDraftScope"),
            ("/api/v1/contracts/drafts/{versionId}/discard", "post", "DiscardManagedContractDraft"),
            ("/api/v1/contracts/drafts/{versionId}/comments", "post", "ReplyManagedContractDraft"),
            ("/api/v1/contracts/drafts/{versionId}", "put", "UpdateManagedContractDraft"),
            ("/api/v1/contracts/drafts/{versionId}/activate", "post", "ActivateManagedContractDraft"),
        })
            Assert.Equal(operation, paths.GetProperty(path).GetProperty(method).GetProperty("operationId").GetString());
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string? command,
        Guid key, object body)
    {
        using var request = new HttpRequestMessage(method,
            command is null ? $"/api/v1/contracts/drafts/{VersionId}" : $"/api/v1/contracts/drafts/{VersionId}/{command}")
        { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        return problem.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
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

    private sealed record Keyed<T>(Guid? Key, T Input);

    private sealed class DraftStub : IContractDraftStore
    {
        public ContractDraftResult Result { get; set; } = ContractDraftResult.Success(VersionId);
        public ContractDraftFailure? ReadFailure { get; set; }
        public Keyed<UpdateContractDraftInput>? LastUpdate { get; private set; }
        public Keyed<SubmitContractDraftInput?>? LastSubmit { get; private set; }
        public Keyed<AirlineDraftCommentInput>? LastComment { get; private set; }
        public Keyed<SetContractDraftScopeInput>? LastScope { get; private set; }
        public DiscardContractDraftInput? LastDiscard { get; private set; }
        public ReplyContractDraftInput? LastReply { get; private set; }

        public Task<ContractDraftOverviewData?> GetOverviewForContractsAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<ContractDraftOverviewData?>(new ContractDraftOverviewData(0, []));

        public Task<IReadOnlyList<ContractDraftData>?> ListForAirlineAsync(Guid actorId,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ContractDraftData>?>([]);

        public Task<IReadOnlyList<ContractDraftData>?> ListForContractsAsync(Guid actorId,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<ContractDraftData>?>([]);

        public Task<ContractDraftResult> AddAirlineCommentAsync(Guid actorId, Guid versionId, AirlineDraftCommentInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastComment = new(idempotencyKey, input);
            return Task.FromResult(Result);
        }

        public Task<ContractDraftResult> ReplyAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
            ReplyContractDraftInput input, CancellationToken cancellationToken = default)
        {
            LastReply = input;
            return Task.FromResult(Result);
        }

        public Task<ContractDraftResult> UpdateAsync(Guid actorId, Guid versionId, UpdateContractDraftInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastUpdate = new(idempotencyKey, input);
            return Task.FromResult(Result);
        }

        public Task<ContractDraftResult> ActivateAsync(Guid actorId, Guid versionId, SubmitContractDraftInput? input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastSubmit = new(idempotencyKey, input);
            return Task.FromResult(Result);
        }

        public Task<ContractDraftQuery<ContractDraftReadinessData>> GetReadinessAsync(Guid actorId, Guid versionId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(ReadFailure is { } failure
                ? ContractDraftQuery.Failed<ContractDraftReadinessData>(failure)
                : ContractDraftQuery.Found(new ContractDraftReadinessData(versionId, Version,
                    "Draft", false, "Invited", [new ContractDraftIssueData("terms_missing", [])])));

        public Task<ContractDraftQuery<ContractDraftScopeData>> GetScopeAsync(Guid actorId, Guid versionId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(ReadFailure is { } failure
                ? ContractDraftQuery.Failed<ContractDraftScopeData>(failure)
                : ContractDraftQuery.Found(new ContractDraftScopeData(versionId, Version, "Draft", [], [])));

        public Task<ContractDraftResult> SetScopeAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
            SetContractDraftScopeInput input, CancellationToken cancellationToken = default)
        {
            LastScope = new(idempotencyKey, input);
            return Task.FromResult(Result);
        }

        public Task<ContractDraftResult> DiscardAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
            DiscardContractDraftInput input, CancellationToken cancellationToken = default)
        {
            LastDiscard = input;
            return Task.FromResult(Result);
        }
    }

    private sealed class LifecycleStub : IContractLifecycleStore
    {
        public ContractLifecycleResult Result { get; set; } = new("Terminated", null, null);
        public Guid? LastKey { get; private set; }

        public Task<ContractTimelineData?> TimelineAsync(Guid actorId, Guid versionId,
            CancellationToken cancellationToken = default) => Task.FromResult<ContractTimelineData?>(null);

        public Task<ContractLifecycleResult> ApplyAsync(Guid actorId, Guid versionId, ContractLifecycleInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastKey = idempotencyKey;
            return Task.FromResult(Result);
        }

        public Task<ContractLifecycleSweep> SweepAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new ContractLifecycleSweep(0, 0, 0, 0, 0));
    }

    private sealed class FinanceBookStub : IFinanceTariffBookStore
    {
        public FinanceCatalogResult Result { get; set; } = FinanceCatalogResult.Success(VersionId);
        public Guid? LastKey { get; private set; }

        public Task<FinanceCatalogResult> DecideContractApprovalAsync(Guid actorId, Guid versionId,
            DecideContractApprovalInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastKey = idempotencyKey;
            return Task.FromResult(Result);
        }

        public Task<IReadOnlyList<FinanceServiceOptionData>?> ListServicesAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<BillingUnitData>?> ListBillingUnitsAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> SaveBillingUnitAsync(Guid actorId, Guid? unitId, SaveBillingUnitInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<TariffVersionSummaryData>?> ListServiceTariffsAsync(Guid actorId, string? currencyCode, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ServiceTariffVersionData?> GetServiceTariffAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> CreateServiceTariffDraftAsync(Guid actorId, CreateTariffDraftInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> SaveServiceTariffDraftAsync(Guid actorId, Guid versionId, SaveServiceTariffDraftInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> PublishServiceTariffAsync(Guid actorId, Guid versionId, string expectedVersion, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> DeleteServiceTariffDraftAsync(Guid actorId, Guid versionId, string expectedVersion, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ChargeDefinitionData>?> ListChargesAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> SaveChargeAsync(Guid actorId, Guid? chargeId, SaveChargeDefinitionInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<TariffVersionSummaryData>?> ListChargeTariffsAsync(Guid actorId, string? currencyCode, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ChargeTariffVersionData?> GetChargeTariffAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> CreateChargeTariffDraftAsync(Guid actorId, CreateTariffDraftInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> SaveChargeTariffDraftAsync(Guid actorId, Guid versionId, SaveChargeTariffDraftInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> PublishChargeTariffAsync(Guid actorId, Guid versionId, string expectedVersion, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> DeleteChargeTariffDraftAsync(Guid actorId, Guid versionId, string expectedVersion, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ExchangeRateData>?> ListExchangeRatesAsync(Guid actorId, DateOnly from, DateOnly to, bool includeHistory, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> RecordExchangeRateAsync(Guid actorId, RecordExchangeRateInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> CorrectExchangeRateAsync(Guid actorId, Guid rateId, CorrectExchangeRateInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ContractApprovalSummaryData>?> ListContractApprovalsAsync(Guid actorId, bool pendingOnly, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ContractApprovalDetailData?> GetContractApprovalAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
