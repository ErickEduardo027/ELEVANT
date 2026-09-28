using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class PreinvoiceDraftEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.NewGuid();
    private static readonly Guid StationId = Guid.NewGuid();
    private static readonly Guid DraftId = Guid.NewGuid();
    private static readonly DateOnly Date = new(2026, 9, 26);

    [Fact]
    public async Task FinanceCreatesAndReadsADraftWithoutCache()
    {
        var stub = new Stub();
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var requestId = Guid.NewGuid();
        var serviceId = Guid.NewGuid();
        using var created = await client.PostAsJsonAsync("/api/v1/finance/preinvoices",
            new { stationId = StationId, from = Date, to = Date,
                requestId, serviceIds = new[] { serviceId } },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        Assert.Contains("no-store", created.Headers.CacheControl?.ToString());
        Assert.Equal(serviceId, Assert.Single(stub.CreateRequest!.ServiceIds));
        using var body = JsonDocument.Parse(await created.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(DraftId, body.RootElement.GetProperty("id").GetGuid());

        using var read = await client.GetAsync($"/api/v1/finance/preinvoices/{DraftId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Contains("no-store", read.Headers.CacheControl?.ToString());
        using var detail = JsonDocument.Parse(await read.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(10m, detail.RootElement.GetProperty("total").GetDecimal());
        Assert.Single(detail.RootElement.GetProperty("lines").EnumerateArray());
        Assert.False(detail.RootElement.TryGetProperty("disputes", out _));
        using var disputeRead = await client.GetAsync(
            $"/api/v1/finance/preinvoices/{DraftId:D}/disputes",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, disputeRead.StatusCode);
        using var disputes = JsonDocument.Parse(await disputeRead.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(DraftId, disputes.RootElement.GetProperty("preinvoiceId").GetGuid());
        Assert.Empty(disputes.RootElement.GetProperty("disputes").EnumerateArray());
    }

    [Fact]
    public async Task RejectsUnauthenticatedAndInvalidSelections()
    {
        var stub = new Stub();
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        using var anonymous = await client.GetAsync($"/api/v1/finance/preinvoices/{DraftId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var invalid = await client.PostAsJsonAsync("/api/v1/finance/preinvoices",
            new { stationId = StationId, from = Date, to = Date,
                requestId = Guid.NewGuid(), serviceIds = Array.Empty<Guid>() },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Null(stub.CreateRequest);
    }

    [Fact]
    public async Task OpenApiPublishesDraftWriteAndRead()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.True(json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/finance/preinvoices").TryGetProperty("post", out _));
        Assert.True(json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/finance/preinvoices/{draftId}").TryGetProperty("get", out _));
        Assert.True(json.RootElement.GetProperty("paths")
            .GetProperty("/api/v1/finance/preinvoices/{draftId}/submit")
            .TryGetProperty("post", out _));
    }

    [Fact]
    public async Task FinanceCanSubmitAnExistingDraftForAirlineReview()
    {
        var stub = new Stub();
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var requestId = Guid.NewGuid();
        using var response = await client.PostAsJsonAsync(
            $"/api/v1/finance/preinvoices/{DraftId:D}/submit",
            new { requestId }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal((AccountId, DraftId, requestId), stub.SubmitRequest);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("Submitted", json.RootElement.GetProperty("status").GetString());

        using var invalid = await client.PostAsJsonAsync(
            $"/api/v1/finance/preinvoices/{DraftId:D}/submit",
            new { requestId = Guid.Empty }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task FinanceIssuesOnlyThroughTheVersionedInvoiceRoute()
    {
        var stub = new Stub();
        await using var application = CreateApplication(stub);
        using var client = application.CreateClient();
        using var anonymous = await client.PostAsJsonAsync("/api/v1/finance/invoices",
            new { preinvoiceId = DraftId, requestId = Guid.NewGuid() },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        var requestId = Guid.NewGuid();
        using var issued = await client.PostAsJsonAsync("/api/v1/finance/invoices",
            new { preinvoiceId = DraftId, requestId }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, issued.StatusCode);
        Assert.Equal(new IssueFinanceInvoiceCommand(AccountId, DraftId, requestId),
            stub.IssueRequest);
        using var body = JsonDocument.Parse(await issued.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("NonFiscal", body.RootElement.GetProperty("kind").GetString());
        Assert.Equal("NF-TEST", body.RootElement.GetProperty("number").GetString());
        using var read = await client.GetAsync(
            $"/api/v1/finance/invoices/by-preinvoice/{DraftId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var detail = JsonDocument.Parse(await read.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("NonFiscal", detail.RootElement.GetProperty("kind").GetString());
        Assert.Single(detail.RootElement.GetProperty("lines").EnumerateArray());
        using var invalid = await client.PostAsJsonAsync("/api/v1/finance/invoices",
            new { preinvoiceId = Guid.Empty, requestId }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task FinanceRecordsPaymentAndReadsItsServerState()
    {
        var stub = new Stub();
        await using var application = CreateApplication(stub, productionTarget: false);
        using var client = application.CreateClient();
        var invoiceId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        using var anonymous = await client.PostAsJsonAsync("/api/v1/finance/payments",
            new { invoiceId, requestId, reference = "BANK-TEST-123" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var recorded = await client.PostAsJsonAsync("/api/v1/finance/payments",
            new { invoiceId, requestId, reference = "BANK-TEST-123" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, recorded.StatusCode);
        Assert.Contains("no-store", recorded.Headers.CacheControl?.ToString());
        Assert.Equal(new RecordNonFiscalPaymentCommand(AccountId, invoiceId, requestId,
            "BANK-TEST-123"), stub.Payment.Request);
        using var body = JsonDocument.Parse(await recorded.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal(10m, body.RootElement.GetProperty("amount").GetDecimal());
        using var read = await client.GetAsync(
            $"/api/v1/finance/payments/by-invoice/{invoiceId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var lookup = JsonDocument.Parse(await read.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.Equal("BANK-TEST-123", lookup.RootElement.GetProperty("payment")
            .GetProperty("reference").GetString());
        using var replay = await client.PostAsJsonAsync("/api/v1/finance/payments",
            new { invoiceId, requestId, reference = "BANK-TEST-123" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        using var replayBody = JsonDocument.Parse(await replay.Content.ReadAsStringAsync(
            TestContext.Current.CancellationToken));
        Assert.True(replayBody.RootElement.GetProperty("replayed").GetBoolean());
        using var invalid = await client.PostAsJsonAsync("/api/v1/finance/payments",
            new { invoiceId, requestId = Guid.Empty, reference = "bad" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
    }

    [Fact]
    public async Task ManualPaymentWriteIsUnavailableOutsideDevelopmentDatabaseTarget()
    {
        var stub = new Stub();
        await using var application = CreateApplication(stub, productionTarget: true);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        using var response = await client.PostAsJsonAsync("/api/v1/finance/payments",
            new { invoiceId = Guid.NewGuid(), requestId = Guid.NewGuid(),
                reference = "BANK-TEST-123" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Null(stub.Payment.Request);
    }

    private WebApplicationFactory<Program> CreateApplication(
        Stub stub, bool? productionTarget = null) =>
        factory.WithWebHostBuilder(builder =>
        {
          if (productionTarget.HasValue) builder.ConfigureAppConfiguration((_, configuration) =>
              configuration.AddInMemoryCollection(new Dictionary<string, string?>
              {
                  [DatabaseTargetGuard.EnvironmentVariable] = productionTarget.Value
                      ? "Production" : "Development",
                  ["ConnectionStrings:ElevantDatabase"] =
                      $"Server=127.0.0.1,65535;Database={(productionTarget.Value
                          ? DatabaseTargetGuard.ProductionDatabaseName
                          : DatabaseTargetGuard.DevelopmentDatabaseName)};" +
                      "Integrated Security=true;Encrypt=true;TrustServerCertificate=true;Connect Timeout=1",
              }));
          builder.ConfigureTestServices(services =>
          {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IPreinvoiceDraftStore>();
            services.RemoveAll<IPreinvoiceSubmissionStore>();
            services.RemoveAll<IFinanceInvoiceIssueStore>();
            services.RemoveAll<INonFiscalInvoiceReadStore>();
            services.RemoveAll<INonFiscalPaymentStore>();
            services.RemoveAll<INonFiscalPaymentReadStore>();
            services.AddSingleton<IActorContextResolver>(stub);
            services.AddSingleton<IPreinvoiceDraftStore>(stub);
            services.AddSingleton<IPreinvoiceSubmissionStore>(stub);
            services.AddSingleton<IFinanceInvoiceIssueStore>(stub);
            services.AddSingleton<INonFiscalInvoiceReadStore>(stub);
            services.AddSingleton<INonFiscalPaymentStore>(stub.Payment);
            services.AddSingleton<INonFiscalPaymentReadStore>(stub.Payment);
          });
        });

    private static string Token()
    {
        var now = DateTimeOffset.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Convert.FromBase64String(
                    ElevantApiFactory.AuthenticationSigningKeyBase64)),
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
    }

    private sealed class Stub : IActorContextResolver, IPreinvoiceDraftStore,
        IPreinvoiceSubmissionStore, IFinanceInvoiceIssueStore, INonFiscalInvoiceReadStore
    {
        public PaymentStub Payment { get; } = new();
        public CreatePreinvoiceDraftCommand? CreateRequest { get; private set; }

        public (Guid AccountId, Guid DraftId, Guid RequestId)? SubmitRequest { get; private set; }

        public IssueFinanceInvoiceCommand? IssueRequest { get; private set; }

        public Task<IssueFinanceInvoiceResult> IssueAsync(IssueFinanceInvoiceCommand command,
            CancellationToken cancellationToken = default)
        {
            IssueRequest = command;
            return Task.FromResult(IssueFinanceInvoiceResult.Success(Guid.NewGuid(), "NF-TEST", false));
        }

        public Task<NonFiscalInvoiceData?> GetForFinanceAsync(Guid accountId, Guid preinvoiceId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<NonFiscalInvoiceData?>(preinvoiceId == DraftId
                ? new NonFiscalInvoiceData(Guid.NewGuid(), DraftId, Guid.NewGuid(), StationId,
                    "NF-TEST", "USD", 10m, DateTimeOffset.UtcNow,
                    [new NonFiscalInvoiceLineData(Guid.NewGuid(), 1, "DEV-TAT", Date,
                        "GPU", "GPU", 1m, "hour", 10m, 10m)]) : null);

        public Task<NonFiscalInvoiceData?> GetForAirlineAsync(Guid organizationId, Guid preinvoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult<NonFiscalInvoiceData?>(null);

        public Task<SubmitPreinvoiceResult> SubmitAsync(SubmitPreinvoiceCommand command,
            CancellationToken cancellationToken = default)
        {
            SubmitRequest = (command.AccountId, command.PreinvoiceId, command.RequestId);
            return Task.FromResult(SubmitPreinvoiceResult.Success(command.PreinvoiceId, false));
        }

        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(AccountId,
                "finance@dev.elevant.test", "Finance",
                [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
                [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                    OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new ActorStationScope(StationId, "PUJ")]));

        public Task<PreinvoiceDraftResult> CreateAsync(CreatePreinvoiceDraftCommand request,
            CancellationToken cancellationToken = default)
        {
            CreateRequest = request;
            return Task.FromResult(PreinvoiceDraftResult.Success(DraftId, false));
        }

        public Task<PreinvoiceDraftDetail?> GetAsync(Guid accountId, Guid draftId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<PreinvoiceDraftDetail?>(draftId == DraftId
                ? new PreinvoiceDraftDetail(DraftId, Guid.NewGuid(), "Test Airline",
                    StationId, Date, Date, "USD", 10m, "Draft",
                    [new PreinvoiceDraftLineDetail(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(),
                        1, "DEV-TAT", Date, "GPU", "GPU", 1m, "hour", 10m, "USD", 10m)])
                : null);

        public Task<IReadOnlyList<Elevant.Application.Commercial.PreinvoiceDisputeData>?> GetDisputesAsync(
            Guid accountId, Guid draftId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<Elevant.Application.Commercial.PreinvoiceDisputeData>?>(
                draftId == DraftId ? [] : null);
    }

    private sealed class PaymentStub : INonFiscalPaymentStore, INonFiscalPaymentReadStore
    {
        public RecordNonFiscalPaymentCommand? Request { get; private set; }
        private Guid PaymentId { get; } = Guid.NewGuid();

        public Task<RecordNonFiscalPaymentResult> RecordAsync(
            RecordNonFiscalPaymentCommand command, CancellationToken cancellationToken = default)
        {
            Request = command;
            return Task.FromResult(RecordNonFiscalPaymentResult.Success(
                PaymentId, command.Reference, 10m, "USD", ++Calls > 1));
        }

        private int Calls { get; set; }

        public Task<NonFiscalPaymentLookupData?> GetForFinanceAsync(
            Guid accountId, Guid invoiceId, CancellationToken cancellationToken = default) =>
            Task.FromResult<NonFiscalPaymentLookupData?>(new NonFiscalPaymentLookupData(
                invoiceId, new NonFiscalPaymentData(Guid.NewGuid(), invoiceId,
                    "BANK-TEST-123", "USD", 10m, DateTimeOffset.UtcNow)));

        public Task<NonFiscalPaymentLookupData?> GetForAirlineAsync(
            Guid organizationId, Guid invoiceId, CancellationToken cancellationToken = default) =>
            Task.FromResult<NonFiscalPaymentLookupData?>(null);
    }
}
