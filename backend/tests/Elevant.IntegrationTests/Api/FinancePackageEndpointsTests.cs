using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 1, block C: the contract amendment (1-C) and the package discard and retirement (1-N27) need the
/// Idempotency-Key, and every Finance failure of packages and tariff books carries a code (1-E).
/// </summary>
public sealed class FinancePackageEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid PackageId = Guid.Parse("78000000-0000-7000-8000-0000000000c1");
    private static readonly Guid VersionId = Guid.Parse("70000000-0000-7000-8000-0000000000c3");
    private const string Version = "AAAAAAAAB9E=";

    [Fact]
    public async Task TheAmendmentNeedsTheKeyAndForwardsTheStatusAndTheStart()
    {
        var store = new PackageStub();
        await using var application = Application(services => Replace<IFinancePackageStore>(services, store));
        using var client = Authorized(application);
        var body = new { expectedStatus = "Active", validFrom = "2026-09-01" };

        using var missing = await client.PostAsJsonAsync($"/api/v1/contracts/versions/{VersionId}/amendments", body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastAmendment);

        var key = Guid.NewGuid();
        using var created = await SendAsync(client, $"/api/v1/contracts/versions/{VersionId}/amendments", key, body);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Equal((key, new CreateAmendmentInput("Active", new DateOnly(2026, 9, 1))),
            (store.LastAmendment?.Key, store.LastAmendment?.Input));
        Assert.Equal(VersionId, (await created.Content.ReadFromJsonAsync<IdBody>(TestContext.Current.CancellationToken))!.Id);

        foreach (var (code, status) in new[]
        {
            ("valid_from_not_after_current", HttpStatusCode.Conflict), ("valid_from_after_current_end", HttpStatusCode.Conflict),
            ("draft_in_progress", HttpStatusCode.Conflict), ("contract_not_amendable", HttpStatusCode.Conflict),
            ("no_approved_version", HttpStatusCode.Conflict), ("version_conflict", HttpStatusCode.Conflict),
            ("idempotency_conflict", HttpStatusCode.Conflict), ("invalid_amendment", HttpStatusCode.BadRequest),
            ("expected_version_required", HttpStatusCode.BadRequest), ("not_found", HttpStatusCode.NotFound),
        })
        {
            store.Result = PackageWriteResult.Fail(code);
            using var response = await SendAsync(client, $"/api/v1/contracts/versions/{VersionId}/amendments", Guid.NewGuid(), body);
            Assert.Equal(status, response.StatusCode);
            Assert.Equal(code, await CodeAsync(response));
        }
        store.Result = PackageWriteResult.Fail("forbidden");
        using var forbidden = await SendAsync(client, $"/api/v1/contracts/versions/{VersionId}/amendments", Guid.NewGuid(), body);
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
    }

    [Theory]
    [InlineData("discard")]
    [InlineData("retire")]
    public async Task DiscardAndRetireNeedTheKeyAndAnswerTheirCodes(string command)
    {
        var store = new PackageStub();
        await using var application = Application(services => Replace<IFinancePackageStore>(services, store));
        using var client = Authorized(application);
        var body = new { expectedVersion = Version, reason = "Precio publicado por error." };
        var path = $"/api/v1/finance/packages/{PackageId}/{command}";

        using var missing = await client.PostAsJsonAsync(path, body, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastLifecycle);

        var key = Guid.NewGuid();
        using var done = await SendAsync(client, path, key, body);
        Assert.Equal(HttpStatusCode.OK, done.StatusCode);
        Assert.Equal((command, key, new PackageLifecycleInput(Version, "Precio publicado por error.")),
            (store.LastLifecycle?.Command, store.LastLifecycle?.Key, store.LastLifecycle?.Input));

        foreach (var (code, status) in new[]
        {
            ("package_not_draft", HttpStatusCode.Conflict), ("package_not_published", HttpStatusCode.Conflict),
            ("version_conflict", HttpStatusCode.Conflict), ("reason_required", HttpStatusCode.BadRequest),
            ("not_found", HttpStatusCode.NotFound),
        })
        {
            store.Result = PackageWriteResult.Fail(code);
            using var response = await SendAsync(client, path, Guid.NewGuid(), body);
            Assert.Equal(status, response.StatusCode);
            Assert.Equal(code, await CodeAsync(response));
        }
    }

    [Fact]
    public async Task TariffBookFailuresAnswerTheirCodeOrTheDefaultOfTheirKind()
    {
        var book = new TariffBookStub();
        await using var application = Application(services => Replace<IFinanceTariffBookStore>(services, book));
        using var client = Authorized(application);
        var draft = new { validFrom = "2027-01-01", validTo = (string?)null, note = (string?)null, expectedVersion = Version,
            rates = new[] { new { serviceId = Guid.NewGuid(), stationId = (Guid?)null, billingUnit = "operación", unitPrice = 1m,
                minimumBillableQuantity = 1m } } };
        foreach (var (result, status, code) in new[]
        {
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid, "billing_unit_unknown"), HttpStatusCode.BadRequest,
                "billing_unit_unknown"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict, "tariff_start_not_after_current"), HttpStatusCode.Conflict,
                "tariff_start_not_after_current"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid), HttpStatusCode.BadRequest, "invalid_finance_data"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict), HttpStatusCode.Conflict, "version_conflict"),
            (FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound), HttpStatusCode.NotFound, "not_found"),
        })
        {
            book.Result = result;
            using var response = await client.PutAsJsonAsync($"/api/v1/finance/service-tariffs/{VersionId}", draft,
                TestContext.Current.CancellationToken);
            Assert.Equal(status, response.StatusCode);
            Assert.Equal(code, await CodeAsync(response));
            // The screens translate the code; the title is Spanish and never English.
            Assert.DoesNotContain("Invalid finance data", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        }
    }

    [Fact]
    public async Task PublishesTheAmendmentAndPackageLifecycleOperations()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var paths = document.RootElement.GetProperty("paths");
        foreach (var (path, operation) in new[]
        {
            ("/api/v1/contracts/versions/{versionId}/amendments", "CreateContractAmendment"),
            ("/api/v1/finance/packages/{id}/discard", "DiscardFinancePackage"),
            ("/api/v1/finance/packages/{id}/retire", "RetireFinancePackage"),
        })
        {
            var post = paths.GetProperty(path).GetProperty("post");
            Assert.Equal(operation, post.GetProperty("operationId").GetString());
            Assert.Contains(post.GetProperty("parameters").EnumerateArray(), parameter =>
                parameter.GetProperty("name").GetString() == "Idempotency-Key" && parameter.GetProperty("required").GetBoolean());
        }
    }

    private sealed record IdBody(Guid Id);

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string path, Guid key, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.Add("Idempotency-Key", key.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
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
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed record Amendment(Guid Key, CreateAmendmentInput Input);
    private sealed record Lifecycle(string Command, Guid Key, PackageLifecycleInput Input);

    private sealed class PackageStub : IFinancePackageStore
    {
        public PackageWriteResult? Result { get; set; }
        public Amendment? LastAmendment { get; private set; }
        public Lifecycle? LastLifecycle { get; private set; }

        public Task<PackageWriteResult> CreateAmendmentAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
            CreateAmendmentInput input, CancellationToken cancellationToken = default)
        {
            LastAmendment = new(idempotencyKey, input);
            return Task.FromResult(Result ?? PackageWriteResult.Success(versionId));
        }

        public Task<PackageWriteResult> DiscardAsync(Guid actorId, Guid id, Guid idempotencyKey, PackageLifecycleInput input,
            CancellationToken cancellationToken = default)
        {
            LastLifecycle = new("discard", idempotencyKey, input);
            return Task.FromResult(Result ?? PackageWriteResult.Success(id));
        }

        public Task<PackageWriteResult> RetireAsync(Guid actorId, Guid id, Guid idempotencyKey, PackageLifecycleInput input,
            CancellationToken cancellationToken = default)
        {
            LastLifecycle = new("retire", idempotencyKey, input);
            return Task.FromResult(Result ?? PackageWriteResult.Success(id));
        }

        public Task<IReadOnlyList<PackageData>?> ListAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PackageWriteResult> SaveAsync(Guid actorId, Guid? id, SavePackageInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PackageWriteResult> PublishAsync(Guid actorId, Guid id, PackageCommandInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<PackageData>?> ListForContractAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<PackageWriteResult> SetContractPackagesAsync(Guid actorId, Guid versionId, SetContractPackagesInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    private sealed class TariffBookStub : IFinanceTariffBookStore
    {
        public FinanceCatalogResult Result { get; set; } = FinanceCatalogResult.Success(VersionId);

        public Task<FinanceCatalogResult> SaveServiceTariffDraftAsync(Guid actorId, Guid versionId,
            SaveServiceTariffDraftInput input, CancellationToken cancellationToken = default) => Task.FromResult(Result);

        public Task<FinanceCatalogResult> DecideContractApprovalAsync(Guid actorId, Guid versionId, DecideContractApprovalInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<FinanceServiceOptionData>?> ListServicesAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<BillingUnitData>?> ListBillingUnitsAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> SaveBillingUnitAsync(Guid actorId, Guid? unitId, SaveBillingUnitInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<TariffVersionSummaryData>?> ListServiceTariffsAsync(Guid actorId, string? currencyCode, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ServiceTariffVersionData?> GetServiceTariffAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> CreateServiceTariffDraftAsync(Guid actorId, CreateTariffDraftInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> PublishServiceTariffAsync(Guid actorId, Guid versionId, string expectedVersion, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> DeleteServiceTariffDraftAsync(Guid actorId, Guid versionId, string expectedVersion, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ChargeDefinitionData>?> ListChargesAsync(Guid actorId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> SaveChargeAsync(Guid actorId, Guid? chargeId, SaveChargeDefinitionInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<TariffVersionSummaryData>?> ListChargeTariffsAsync(Guid actorId, string? currencyCode, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ChargeTariffVersionData?> GetChargeTariffAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> CreateChargeTariffDraftAsync(Guid actorId, CreateTariffDraftInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> SaveChargeTariffDraftAsync(Guid actorId, Guid versionId, SaveChargeTariffDraftInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> PublishChargeTariffAsync(Guid actorId, Guid versionId, string expectedVersion, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> DeleteChargeTariffDraftAsync(Guid actorId, Guid versionId, string expectedVersion, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ExchangeRateData>?> ListExchangeRatesAsync(Guid actorId, DateOnly from, DateOnly to, bool includeHistory, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> RecordExchangeRateAsync(Guid actorId, RecordExchangeRateInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<FinanceCatalogResult> CorrectExchangeRateAsync(Guid actorId, Guid rateId, CorrectExchangeRateInput input, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<ContractApprovalSummaryData>?> ListContractApprovalsAsync(Guid actorId, bool pendingOnly, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<ContractApprovalDetailData?> GetContractApprovalAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
