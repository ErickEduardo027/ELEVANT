using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Contract documents and lifecycle (phase 2, block A): the withdrawal of an unsigned version needs its
/// Idempotency-Key, the validity step passes an optional one, the surcharges and packages of a version are
/// read with Spanish, coded failures, and a termination carries its effective date or immediate cause.
/// </summary>
public sealed class ContractDocumentEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
    private static readonly Guid VersionId = Guid.Parse("70000000-0000-7000-8000-0000000000d1");
    private static readonly string Sha = new('a', 64);

    [Fact]
    public async Task WithdrawalNeedsTheIdempotencyKeyAndAnswersTheWithdrawnVersion()
    {
        var store = new DocumentStub();
        await using var application = Application(services => Replace<IContractDocumentStore>(services, store));
        using var client = Authorized(application);
        var body = new { reason = "La vigencia quedó mal fijada.", expectedDocumentSha256 = Sha };

        using var missing = await client.PostAsJsonAsync($"/api/v1/contract-versions/{VersionId}/withdrawal", body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Null(store.LastWithdrawal);

        var key = Guid.NewGuid();
        using var withdrawn = await SendAsync(client, HttpMethod.Post, "withdrawal", key, body);
        Assert.Equal(HttpStatusCode.OK, withdrawn.StatusCode);
        Assert.Equal((key, new WithdrawContractVersionInput(body.reason, Sha)), store.LastWithdrawal);
        using var answer = JsonDocument.Parse(await withdrawn.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(["versionId", "versionStatus", "contractStatus", "draftVersionId"],
            answer.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.Equal("Rejected", answer.RootElement.GetProperty("versionStatus").GetString());

        foreach (var (failure, code, status) in new[]
        {
            (ContractDocumentFailure.Conflict, "version_signed", HttpStatusCode.Conflict),
            (ContractDocumentFailure.Conflict, "content_changed", HttpStatusCode.Conflict),
            (ContractDocumentFailure.Invalid, "reason_required", HttpStatusCode.BadRequest),
            (ContractDocumentFailure.NotFound, "not_found", HttpStatusCode.NotFound),
            (ContractDocumentFailure.Forbidden, "forbidden", HttpStatusCode.Forbidden),
        })
        {
            store.Withdrawal = ContractWithdrawalResult.Failed(failure, code);
            using var refused = await SendAsync(client, HttpMethod.Post, "withdrawal", Guid.NewGuid(), body);
            Assert.Equal(status, refused.StatusCode);
            var problem = await ProblemAsync(refused);
            Assert.Equal(code, problem.Code);
            // Spanish titles only; never the English text of the past.
            Assert.DoesNotContain("The ", problem.Title, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task ValidityPassesTheOptionalKeyAndPricingTermsAnswerWithCodes()
    {
        var store = new DocumentStub();
        await using var application = Application(services => Replace<IContractDocumentStore>(services, store));
        using var client = Authorized(application);
        var validity = new { validFrom = "2027-01-01", validTo = "2027-12-31", renewalMode = "Manual",
            renewalTermMonths = (int?)null, renewalNoticeDays = 0, terminationNoticeDays = 0, terminationTerms = (string?)null,
            expectedDocumentSha256 = Sha };
        using var withoutKey = await client.PutAsJsonAsync($"/api/v1/contract-versions/{VersionId}/validity", validity,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, withoutKey.StatusCode);
        Assert.Null(store.LastValidityKey);
        var key = Guid.NewGuid();
        using var withKey = await SendAsync(client, HttpMethod.Put, "validity", key, validity);
        Assert.Equal(HttpStatusCode.OK, withKey.StatusCode);
        Assert.Equal(key, store.LastValidityKey);

        using var terms = await client.GetAsync($"/api/v1/contract-versions/{VersionId}/pricing-terms",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, terms.StatusCode);
        using var read = JsonDocument.Parse(await terms.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(["versionId", "currencyCode", "inDocument", "signed", "charges", "packages"],
            read.RootElement.EnumerateObject().Select(property => property.Name).ToArray());
        Assert.True(read.RootElement.GetProperty("charges")[0].GetProperty("isExcluded").GetBoolean());

        store.Pricing = new ContractPricingTermsResult(null, ContractDocumentFailure.NotFound);
        using var missing = await client.GetAsync($"/api/v1/contract-versions/{VersionId}/pricing-terms",
            TestContext.Current.CancellationToken);
        Assert.Equal((HttpStatusCode.NotFound, "not_found"), (missing.StatusCode, (await ProblemAsync(missing)).Code));
    }

    [Fact]
    public async Task ATerminationCarriesItsEffectiveDateOrImmediateCause()
    {
        var lifecycle = new LifecycleStub();
        await using var application = Application(services => Replace<IContractLifecycleStore>(services, lifecycle));
        using var client = Authorized(application);
        using var scheduled = await client.PostAsJsonAsync($"/api/v1/contract-versions/{VersionId}/lifecycle",
            new { action = "Terminate", reason = "Fin de la relación comercial.", expectedStatus = "Active",
                effectiveOn = "2027-01-05" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, scheduled.StatusCode);
        Assert.Equal((new DateOnly(2027, 1, 5), (string?)null), (lifecycle.Last?.EffectiveOn, lifecycle.Last?.ImmediateCause));
        lifecycle.Result = ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "termination_notice_not_met");
        using var refused = await client.PostAsJsonAsync($"/api/v1/contract-versions/{VersionId}/lifecycle",
            new { action = "Terminate", reason = "Fin de la relación comercial.", expectedStatus = "Active",
                immediateCause = "Breach" }, TestContext.Current.CancellationToken);
        Assert.Equal((HttpStatusCode.BadRequest, "termination_notice_not_met"),
            (refused.StatusCode, (await ProblemAsync(refused)).Code));
        Assert.Equal("Breach", lifecycle.Last?.ImmediateCause);
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string command, Guid key,
        object body)
    {
        using var request = new HttpRequestMessage(method, $"/api/v1/contract-versions/{VersionId}/{command}")
            { Content = JsonContent.Create(body) };
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

    private static ContractDocumentData Document() => new(Guid.NewGuid(), VersionId, "CTR-2026-0001", "Active", "Demo Air",
        "DM", null, 2, "Approved", new DateOnly(2027, 1, 1), new DateOnly(2027, 12, 31), "USD", ["PUJ · Punta Cana"],
        [new ContractDocumentRate("RAMP", "Rampa", "operation", 150m, 1m)], "Pago a 30 días.", null, []);

    private sealed class DocumentStub : IContractDocumentStore
    {
        public ContractWithdrawalResult Withdrawal { get; set; } = new(new ContractWithdrawalData(VersionId, "Rejected", "Active",
            null), null);
        public ContractPricingTermsResult Pricing { get; set; } = new(new ContractPricingTermsData(VersionId, "USD", true, false,
            [new ContractDocumentCharge("NIGHT", "Recargo nocturno", "PercentOfService", null, "One", 0, 0m, true, null, null)],
            []), null);
        public (Guid Key, WithdrawContractVersionInput Input)? LastWithdrawal { get; private set; }
        public Guid? LastValidityKey { get; private set; }

        public Task<ContractDocumentResult> ReadAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new ContractDocumentResult(Document(), null));

        public Task<ContractDocumentResult> ReadDraftAsync(Guid actorId, Guid versionId,
            CancellationToken cancellationToken = default) => Task.FromResult(new ContractDocumentResult(Document(), null));

        public Task<ContractDocumentResult> SignAsync(Guid actorId, Guid versionId, SignContractInput input,
            CancellationToken cancellationToken = default) => Task.FromResult(new ContractDocumentResult(Document(), null));

        public Task<ContractDocumentResult> SetValidityAsync(Guid actorId, Guid versionId, ContractValidityInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastValidityKey = idempotencyKey;
            return Task.FromResult(new ContractDocumentResult(Document(), null));
        }

        public Task<ContractWithdrawalResult> WithdrawAsync(Guid actorId, Guid versionId, WithdrawContractVersionInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastWithdrawal = (idempotencyKey, input);
            return Task.FromResult(Withdrawal);
        }

        public Task<ContractPricingTermsResult> ReadPricingTermsAsync(Guid actorId, Guid versionId,
            CancellationToken cancellationToken = default) => Task.FromResult(Pricing);
    }

    private sealed class LifecycleStub : IContractLifecycleStore
    {
        public ContractLifecycleResult Result { get; set; } = new("Active", null, null);
        public ContractLifecycleInput? Last { get; private set; }

        public Task<ContractTimelineData?> TimelineAsync(Guid actorId, Guid versionId,
            CancellationToken cancellationToken = default) => Task.FromResult<ContractTimelineData?>(null);

        public Task<ContractLifecycleResult> ApplyAsync(Guid actorId, Guid versionId, ContractLifecycleInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            Last = input;
            return Task.FromResult(Result);
        }

        public Task<ContractLifecycleSweep> SweepAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new ContractLifecycleSweep(0, 0, 0, 0, 0));
    }
}
