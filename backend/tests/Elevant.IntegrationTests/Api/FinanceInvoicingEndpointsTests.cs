using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>«Por facturar», the no-charge closure and the coded issuance (phase 4, block A) over HTTP.</summary>
public sealed class FinanceInvoicingEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid Account = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid Station = Guid.NewGuid();

    [Fact]
    public async Task RoutesAreDocumentedAndTheClosureRequiresItsKey()
    {
        await using var app = App(new Stub());
        using var client = app.CreateClient();
        var ct = TestContext.Current.CancellationToken;
        using var anonymous = await client.GetAsync($"/api/v1/finance/invoicing/pending-operations?stationId={Station}", ct);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
        using var swagger = await client.GetAsync("/swagger/v1/swagger.json", ct);
        swagger.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await swagger.Content.ReadAsStringAsync(ct));
        var paths = json.RootElement.GetProperty("paths");
        Assert.True(paths.TryGetProperty("/api/v1/finance/invoicing/pending-operations", out var pending));
        Assert.Equal("GetFinancePendingOperations", pending.GetProperty("get").GetProperty("operationId").GetString());
        var closure = paths.GetProperty("/api/v1/finance/invoicing/no-charge-closures").GetProperty("post");
        Assert.Equal("CloseOperationsWithoutCharge", closure.GetProperty("operationId").GetString());
        Assert.Contains(closure.GetProperty("parameters").EnumerateArray(), parameter =>
            parameter.GetProperty("name").GetString() == "Idempotency-Key" && parameter.GetProperty("in").GetString() == "header" &&
            parameter.GetProperty("required").GetBoolean());
    }

    [Fact]
    public async Task PendingOperationsCodeTheirRefusalsAndPublishTheLimits()
    {
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        var ct = TestContext.Current.CancellationToken;
        foreach (var query in new[] { "", $"?stationId={Station}&from=nope", $"?stationId={Station}&limit=101",
                     $"?stationId={Station}&cursor=%2B%2B" })
        {
            using var invalid = await client.GetAsync($"/api/v1/finance/invoicing/pending-operations{query}", ct);
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
            Assert.Equal("invalid_pending_query", await CodeAsync(invalid, ct));
        }
        using var foreign = await client.GetAsync($"/api/v1/finance/invoicing/pending-operations?stationId={Guid.NewGuid()}", ct);
        Assert.Equal((HttpStatusCode.NotFound, "not_found"), (foreign.StatusCode, await CodeAsync(foreign, ct)));

        using var ok = await client.GetAsync(
            $"/api/v1/finance/invoicing/pending-operations?stationId={Station}&from=2026-11-01&limit=10", ct);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Contains("no-store", ok.Headers.CacheControl?.ToString());
        Assert.Equal((new DateOnly(2026, 11, 1), 10), (stub.Query!.From, stub.Query.Limit));
        using var body = JsonDocument.Parse(await ok.Content.ReadAsStringAsync(ct));
        var limits = body.RootElement.GetProperty("limits");
        Assert.Equal((100, 500, 31), (limits.GetProperty("maxOperations").GetInt32(), limits.GetProperty("maxLines").GetInt32(),
            limits.GetProperty("maxDays").GetInt32()));
        var operation = Assert.Single(body.RootElement.GetProperty("operations").EnumerateArray());
        Assert.Equal("exchange_rate_missing", Assert.Single(operation.GetProperty("blockingReasons").EnumerateArray()).GetString());
        Assert.Equal(7, body.RootElement.GetProperty("totalPending").GetInt32());
        Assert.Equal("next", body.RootElement.GetProperty("nextCursor").GetString());
    }

    [Fact]
    public async Task TheClosureNeedsItsKeyAndAnswersCodes()
    {
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        var ct = TestContext.Current.CancellationToken;
        var operation = Guid.NewGuid();
        var body = new { stationId = Station, operations = new[] { new { operationId = operation, version = "AAAAAAAAB9E=" } },
            reason = "Servicios incluidos sin tarifa" };

        using (var missing = await client.PostAsJsonAsync("/api/v1/finance/invoicing/no-charge-closures", body, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (missing.StatusCode, await CodeAsync(missing, ct)));
        using (var malformed = await SendAsync(client, "not-a-uuid", body, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (malformed.StatusCode, await CodeAsync(malformed, ct)));
        using (var unknown = await SendAsync(client, Guid.NewGuid().ToString(), new { body.stationId, body.operations, body.reason,
                   total = 0 }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_invoice_request"), (unknown.StatusCode, await CodeAsync(unknown, ct)));
        using (var shortReason = await SendAsync(client, Guid.NewGuid().ToString(), body with { reason = "no" }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "reason_required"), (shortReason.StatusCode, await CodeAsync(shortReason, ct)));
        using (var longReason = await SendAsync(client, Guid.NewGuid().ToString(), body with { reason = new string('x', 501) }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "reason_required"), (longReason.StatusCode, await CodeAsync(longReason, ct)));
        Assert.Null(stub.Closure);

        var key = Guid.NewGuid();
        using (var created = await SendAsync(client, key.ToString(), body, ct))
        {
            Assert.Equal(HttpStatusCode.Created, created.StatusCode);
            using var json = JsonDocument.Parse(await created.Content.ReadAsStringAsync(ct));
            Assert.Equal(operation, Assert.Single(json.RootElement.GetProperty("operationIds").EnumerateArray()).GetGuid());
            Assert.False(json.RootElement.GetProperty("replayed").GetBoolean());
        }
        Assert.Equal((key, "Servicios incluidos sin tarifa", Station), (stub.Closure!.IdempotencyKey, stub.Closure.Reason,
            stub.Closure.StationId));
        stub.ClosureReplayed = true;
        using (var replayed = await SendAsync(client, key.ToString(), body, ct))
            Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);
        stub.ClosureFailure = (IssueInvoiceFailure.Unprocessable, "operation_has_charge");
        using (var charged = await SendAsync(client, key.ToString(), body, ct))
            Assert.Equal((HttpStatusCode.UnprocessableEntity, "operation_has_charge"), (charged.StatusCode, await CodeAsync(charged, ct)));
        stub.ClosureFailure = (IssueInvoiceFailure.Conflict, "idempotency_conflict");
        using (var conflict = await SendAsync(client, key.ToString(), body, ct))
            Assert.Equal((HttpStatusCode.Conflict, "idempotency_conflict"), (conflict.StatusCode, await CodeAsync(conflict, ct)));
    }

    [Fact]
    public async Task TheIssuanceCodesEveryRefusalAndKeepsReasonsForOlderClients()
    {
        var stub = new Stub { IssueFailure = (IssueInvoiceFailure.Unprocessable, "zero_total") };
        await using var app = App(stub);
        using var client = Authorized(app);
        var ct = TestContext.Current.CancellationToken;
        var operation = Guid.NewGuid();
        using (var zero = await client.PostAsJsonAsync("/api/v1/finance/invoices/from-operations", new
               {
                   stationId = Station, operationIds = new[] { operation }, requestId = Guid.NewGuid(),
                   operationVersions = new[] { new { operationId = operation, version = "AAAAAAAAB9E=" } },
               }, ct))
        {
            Assert.Equal(HttpStatusCode.UnprocessableEntity, zero.StatusCode);
            Assert.Equal("application/problem+json", zero.Content.Headers.ContentType?.MediaType);
            using var json = JsonDocument.Parse(await zero.Content.ReadAsStringAsync(ct));
            Assert.Equal("zero_total", json.RootElement.GetProperty("code").GetString());
            Assert.Equal("zero_total", Assert.Single(json.RootElement.GetProperty("reasons").EnumerateArray()).GetString());
        }
        Assert.Equal("AAAAAAAAB9E=", Assert.Single(stub.Issue!.OperationVersions!).Version);
        using (var unknown = await client.PostAsJsonAsync("/api/v1/finance/invoices/from-operations",
                   new { stationId = Station, operationIds = new[] { operation }, requestId = Guid.NewGuid(), total = 1 }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_invoice_request"), (unknown.StatusCode, await CodeAsync(unknown, ct)));
        using (var partial = await client.PostAsJsonAsync("/api/v1/finance/invoices/from-operations", new
               {
                   stationId = Station, operationIds = new[] { operation, Guid.NewGuid() }, requestId = Guid.NewGuid(),
                   operationVersions = new[] { new { operationId = operation, version = "AAAAAAAAB9E=" } },
               }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_invoice_request"), (partial.StatusCode, await CodeAsync(partial, ct)));
    }

    /// <summary>
    /// 4-N06: more operations than one invoice takes is too_many_operations on both writes over HTTP, never the generic
    /// invalid_invoice_request, and nothing reaches the store; an empty list stays a malformed request.
    /// </summary>
    [Fact]
    public async Task MoreOperationsThanOneInvoiceAreTooManyOverHttp()
    {
        var stub = new Stub();
        await using var app = App(stub);
        using var client = Authorized(app);
        var ct = TestContext.Current.CancellationToken;
        var operations = Enumerable.Range(0, FinanceInvoicePolicy.MaxOperations + 1).Select(_ => Guid.NewGuid()).ToArray();
        var versions = operations.Select(id => new { operationId = id, version = "AAAAAAAAB9E=" }).ToArray();

        using (var issue = await client.PostAsJsonAsync("/api/v1/finance/invoices/from-operations",
                   new { stationId = Station, operationIds = operations, requestId = Guid.NewGuid(), operationVersions = versions }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "too_many_operations"), (issue.StatusCode, await CodeAsync(issue, ct)));
        using (var older = await client.PostAsJsonAsync("/api/v1/finance/invoices/from-operations",
                   new { stationId = Station, operationIds = operations, requestId = Guid.NewGuid() }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "too_many_operations"), (older.StatusCode, await CodeAsync(older, ct)));
        using (var closure = await SendAsync(client, Guid.NewGuid().ToString(),
                   new { stationId = Station, operations = versions, reason = "Servicios incluidos sin tarifa" }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "too_many_operations"), (closure.StatusCode, await CodeAsync(closure, ct)));
        using (var empty = await client.PostAsJsonAsync("/api/v1/finance/invoices/from-operations",
                   new { stationId = Station, operationIds = Array.Empty<Guid>(), requestId = Guid.NewGuid() }, ct))
            Assert.Equal((HttpStatusCode.BadRequest, "invalid_invoice_request"), (empty.StatusCode, await CodeAsync(empty, ct)));
        Assert.Null(stub.Issue);
        Assert.Null(stub.Closure);
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string key, object body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/finance/invoicing/no-charge-closures")
        {
            Content = new StringContent(JsonSerializer.Serialize(body, JsonSerializerOptions.Web), Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await client.SendAsync(request, ct);
    }

    private static async Task<string?> CodeAsync(HttpResponseMessage response, CancellationToken ct)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
        return json.RootElement.TryGetProperty("code", out var code) ? code.GetString() : null;
    }

    private WebApplicationFactory<Program> App(Stub stub) => factory.WithWebHostBuilder(builder =>
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IFinancePendingOperationsReadStore>();
            services.RemoveAll<IInvoiceIssuanceStore>();
            services.AddSingleton<IActorContextResolver>(stub);
            services.AddSingleton<IFinancePendingOperationsReadStore>(stub);
            services.AddSingleton<IInvoiceIssuanceStore>(stub);
        }));

    private static HttpClient Authorized(WebApplicationFactory<Program> app)
    {
        var client = app.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience, Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime, Issuer = ElevantApiFactory.AuthenticationIssuer, NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)), SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, Account.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private sealed class Stub : IActorContextResolver, IFinancePendingOperationsReadStore, IInvoiceIssuanceStore
    {
        public GetFinancePendingOperationsQuery? Query { get; private set; }
        public NoChargeClosureCommand? Closure { get; private set; }
        public IssueInvoiceRequest? Issue { get; private set; }
        public bool ClosureReplayed { get; set; }
        public (IssueInvoiceFailure Failure, string Code)? ClosureFailure { get; set; }
        public (IssueInvoiceFailure Failure, string Code)? IssueFailure { get; init; }

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(Account, "finance@dev.elevant.test", "Finance",
                [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
                [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM", OrganizationType.AviamOperator,
                    MembershipKind.InternalStaff)],
                [new ActorStationScope(Station, "PUJ")],
                new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance,
                    new HashSet<string> { "finance.invoicing.read", "finance.invoicing.issue" })));

        public Task<FinancePendingOperationsData?> GetAsync(GetFinancePendingOperationsQuery query,
            CancellationToken cancellationToken = default)
        {
            Query = query;
            return Task.FromResult<FinancePendingOperationsData?>(new FinancePendingOperationsData(query.StationId,
                [new FinancePendingAirlineData(Guid.NewGuid(), "Demo Airlines", 7)],
                [new FinancePendingOperationData(Guid.NewGuid(), "AAAAAAAAB9E=", "DEV-TAT-0001", new DateOnly(2026, 11, 2),
                    Guid.NewGuid(), "Demo Airlines", "DM101", "DEV-CONTRACT-0001", "DOP", 1, 2, 897.5m, false,
                    ["exchange_rate_missing"], [new FinancePendingServiceData(Guid.NewGuid(), "BAG", "Equipaje", true, null, 20m, 1)])],
                "next", 7));
        }

        public Task<int?> CountAsync(Guid accountId, Guid stationId, CancellationToken cancellationToken = default) =>
            Task.FromResult<int?>(7);

        public Task<IssueInvoiceResult> IssueAsync(IssueInvoiceRequest request, CancellationToken cancellationToken = default)
        {
            Issue = request;
            return Task.FromResult(IssueFailure is { } failure
                ? IssueInvoiceResult.Failed(failure.Failure, failure.Code)
                : IssueInvoiceResult.Success(Guid.NewGuid(), "NF-x", "E310000000001", 118m, "USD", false));
        }

        public Task<NoChargeClosureResult> CloseWithoutChargeAsync(NoChargeClosureCommand request,
            CancellationToken cancellationToken = default)
        {
            Closure = request;
            return Task.FromResult(ClosureFailure is { } failure
                ? NoChargeClosureResult.Failed(failure.Failure, failure.Code)
                : NoChargeClosureResult.Success(new NoChargeClosureData(Guid.NewGuid(),
                    request.Operations.Select(item => item.OperationId).ToArray()), ClosureReplayed));
        }
    }
}
