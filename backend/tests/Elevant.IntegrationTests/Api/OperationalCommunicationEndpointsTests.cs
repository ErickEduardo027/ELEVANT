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

public sealed class OperationalCommunicationEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OperationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
    private static readonly Guid NotificationId = Guid.Parse("90000000-0000-7000-8000-000000000001");
    private static readonly Guid InstallationId = Guid.Parse("a0000000-0000-7000-8000-000000000001");
    private static readonly Guid ClientMessageId = Guid.Parse("b0000000-0000-7000-8000-000000000001");
    private static readonly DateTimeOffset Instant = new(2026, 9, 24, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task ConversationsRequireAuthAndDoNotReadAnotherStation()
    {
        var state = new State { Actor = OccActor() };
        await using var application = CreateApplication(state);
        using var anonymous = application.CreateClient();
        using var unauthorized = await anonymous.GetAsync(
            $"/api/v1/chat/conversations?stationId={StationId:D}", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

        using var client = Authorized(application);
        using var outOfScope = await client.GetAsync(
            "/api/v1/chat/conversations?stationId=20000000-0000-7000-8000-000000000099",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, outOfScope.StatusCode);
        Assert.Equal(0, state.ConversationReads);

        using var scoped = await client.GetAsync(
            $"/api/v1/chat/conversations?stationId={StationId:D}", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, scoped.StatusCode);
        Assert.Equal(1, state.ConversationReads);
        var body = await scoped.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal(OperationId, body.GetProperty("conversations")[0].GetProperty("operationId").GetGuid());
    }

    [Theory]
    [InlineData("/api/v1/chat/conversations?offset=-1")]
    [InlineData("/api/v1/chat/conversations?offset=1.5")]
    [InlineData("/api/v1/chat/conversations?offset=2147483648")]
    [InlineData("/api/v1/chat/conversations/70000000-0000-7000-8000-000000000005/messages?offset=-1")]
    public async Task ChatRejectsInvalidOffsets(string path)
    {
        var state = new State { Actor = OccActor() };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, state.ConversationReads);
        Assert.Equal(-1, state.MessageOffset);
    }

    [Fact]
    public async Task ChatDefaultsOffsetsToZeroAndForwardsSubsequentPages()
    {
        var state = new State { Actor = OccActor() };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        using var firstConversations = await client.GetAsync($"/api/v1/chat/conversations?stationId={StationId:D}", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, firstConversations.StatusCode);
        Assert.Equal(0, state.ConversationOffset);
        using var firstMessages = await client.GetAsync($"/api/v1/chat/conversations/{OperationId:D}/messages", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, firstMessages.StatusCode);
        Assert.Equal(0, state.MessageOffset);
        using var conversations = await client.GetAsync($"/api/v1/chat/conversations?stationId={StationId:D}&offset=100", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, conversations.StatusCode);
        Assert.Equal(100, state.ConversationOffset);
        using var messages = await client.GetAsync($"/api/v1/chat/conversations/{OperationId:D}/messages?offset=200", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, messages.StatusCode);
        Assert.Equal(200, state.MessageOffset);
    }

    [Fact]
    public async Task MobileSendRequiresInstallationAndPassesIdempotencyKey()
    {
        var state = new State { Actor = AgentActor() };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        using var withoutDevice = await Send(client, null);
        Assert.Equal(HttpStatusCode.BadRequest, withoutDevice.StatusCode);
        Assert.Null(state.Sent);

        using var controlCharacter = await Send(client, InstallationId, "Invalid\u0001message");
        Assert.Equal(HttpStatusCode.BadRequest, controlCharacter.StatusCode);
        Assert.Null(state.Sent);

        using var accepted = await Send(client, InstallationId);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.NotNull(state.Sent);
        Assert.Equal(InstallationId, state.Sent.InstallationId);
        Assert.Equal(ClientMessageId, state.Sent.ClientMessageId);
        Assert.Equal("Mensaje de prueba", state.Sent.Content);
        var body = await accepted.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal("agent", body.GetProperty("senderRole").GetString());
    }

    [Fact]
    public async Task NotificationReadIsAccountScopedByTheStore()
    {
        var state = new State { Actor = OccActor() };
        await using var application = CreateApplication(state);
        using var client = Authorized(application);
        using var list = await client.GetAsync("/api/v1/notifications", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var body = await list.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal(NotificationId, body.GetProperty("notifications")[0].GetProperty("id").GetGuid());

        using var updated = await client.PutAsJsonAsync(
            $"/api/v1/notifications/{NotificationId:D}/read", new { read = true },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal((AccountId, NotificationId, true), state.Marked);
        var result = await updated.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.False(result.GetProperty("readAt").ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task OpenApiPublishesOnlyVersionedCommunicationRoutes()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json", TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        var paths = document.GetProperty("paths");
        Assert.True(paths.GetProperty("/api/v1/chat/conversations").TryGetProperty("get", out _));
        Assert.True(paths.GetProperty("/api/v1/chat/conversations/{operationId}/messages").TryGetProperty("post", out _));
        Assert.True(paths.GetProperty("/api/v1/notifications").TryGetProperty("get", out _));
        Assert.True(paths.GetProperty("/api/v1/notifications/{notificationId}/read").TryGetProperty("put", out _));
    }

    [Fact]
    public async Task PresenceIsAuthorizedScopedAndDoesNotResurrectClosedClients()
    {
        var state = new State { Actor = OccActor() };
        await using var application = CreateApplication(state);
        using var anonymous = application.CreateClient();
        using var unauthorized = await anonymous.GetAsync("/api/v1/chat/presence?operationIds=" + OperationId, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        using var client = Authorized(application);
        var lease = Guid.NewGuid();
        using var sent = await client.PutAsJsonAsync("/api/v1/chat/presence",
            new { clientId = lease, sequence = 1, mode = "foreground", activityObserved = true }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, sent.StatusCode);
        var other = Guid.NewGuid();
        using var read = await client.GetAsync($"/api/v1/chat/presence?operationIds={OperationId}&operationIds={other}", TestContext.Current.CancellationToken);
        var body = await read.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Single(body.GetProperty("operations").EnumerateArray());
        var person = body.GetProperty("operations")[0].GetProperty("participants")[0];
        Assert.Equal(AccountId, person.GetProperty("accountId").GetGuid());
        Assert.Equal("active", person.GetProperty("state").GetString());
        using var closed = await client.PutAsJsonAsync("/api/v1/chat/presence",
            new { clientId = lease, sequence = 3, mode = "closed", activityObserved = false }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, closed.StatusCode);
        using var late = await client.PutAsJsonAsync("/api/v1/chat/presence",
            new { clientId = lease, sequence = 2, mode = "foreground", activityObserved = true }, TestContext.Current.CancellationToken);
        using var after = await client.GetAsync("/api/v1/chat/presence?operationIds=" + OperationId, TestContext.Current.CancellationToken);
        var result = await after.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal("offline", result.GetProperty("operations")[0].GetProperty("participants")[0].GetProperty("state").GetString());
        using var excessive = await client.GetAsync("/api/v1/chat/presence?" + string.Join("&", Enumerable.Range(0, 101).Select(_ => "operationIds=" + Guid.NewGuid())), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, excessive.StatusCode);
    }

    [Fact]
    public async Task ChosenPresenceStatusIsOwnedValidatedAndPublishedToParticipants()
    {
        await using var application = CreateApplication(new State { Actor = OccActor() });
        using var anonymous = application.CreateClient();
        using var unauthorized = await anonymous.GetAsync("/api/v1/chat/presence/status", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        using var client = Authorized(application);
        using var invalid = await client.PutAsJsonAsync("/api/v1/chat/presence/status",
            new { availability = "active", message = (string?)null }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        using var set = await client.PutAsJsonAsync("/api/v1/chat/presence/status",
            new { availability = "doNotDisturb", message = "Atendiendo operaciones de Arajet" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        var own = await set.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken);
        Assert.Equal("unknown", own.GetProperty("state").GetString());
        Assert.Equal("doNotDisturb", own.GetProperty("availability").GetString());
        using var lease = await client.PutAsJsonAsync("/api/v1/chat/presence",
            new { clientId = Guid.NewGuid(), sequence = 1, mode = "foreground", activityObserved = true }, TestContext.Current.CancellationToken);
        using var read = await client.GetAsync("/api/v1/chat/presence?operationIds=" + OperationId, TestContext.Current.CancellationToken);
        var person = (await read.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken))
            .GetProperty("operations")[0].GetProperty("participants")[0];
        Assert.Equal("active", person.GetProperty("state").GetString());
        Assert.Equal("doNotDisturb", person.GetProperty("availability").GetString());
        Assert.Equal("Atendiendo operaciones de Arajet", person.GetProperty("message").GetString());
        using var current = await client.GetAsync("/api/v1/chat/presence/status", TestContext.Current.CancellationToken);
        Assert.Equal("active", (await current.Content.ReadFromJsonAsync<JsonElement>(TestContext.Current.CancellationToken)).GetProperty("state").GetString());
    }

    [Theory]
    [InlineData(-1, "foreground")]
    [InlineData(1, "available")]
    public async Task PresenceRejectsInvalidHeartbeats(long sequence, string mode)
    {
        await using var application = CreateApplication(new State { Actor = OccActor() });
        using var client = Authorized(application);
        using var response = await client.PutAsJsonAsync("/api/v1/chat/presence",
            new { clientId = Guid.NewGuid(), sequence, mode, activityObserved = true }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private WebApplicationFactory<Program> CreateApplication(State state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IOperationalCommunicationStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IOperationalCommunicationStore>(_ => state);
        }));

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, Guid? installationId, string content = "  Mensaje de prueba  ")
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/chat/conversations/{OperationId:D}/messages")
        {
            Content = JsonContent.Create(new { content }),
        };
        request.Headers.Add("Idempotency-Key", ClientMessageId.ToString("D"));
        if (installationId is Guid id)
            request.Headers.Add("X-Elevant-Installation-Id", id.ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var key = new SymmetricSecurityKey(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType, Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static ActorContext OccActor() => new(
        AccountId, "occ@dev.elevant.test", "OCC Test",
        [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "admin_occ")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

    private static ActorContext AgentActor() => new(
        AccountId, "agent@dev.elevant.test", "Agent Test",
        [new ActorRole(Guid.NewGuid(), "RAMP_AGENT", "Agent", PortalKind.RampMobileApp, "ramp_agent")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

    private sealed class State : IActorContextResolver, IOperationalCommunicationStore
    {
        public ActorContext? Actor { get; init; }
        public int ConversationReads { get; private set; }
        public int ConversationOffset { get; private set; } = -1;
        public int MessageOffset { get; private set; } = -1;
        public SendOperationMessageCommand? Sent { get; private set; }
        public (Guid AccountId, Guid NotificationId, bool Read)? Marked { get; private set; }

        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(accountId == AccountId ? Actor : null);

        public Task<CommunicationResult<OperationConversationListData>> GetConversationsAsync(
            OperationalAccess access, Guid? stationId, int offset, CancellationToken cancellationToken = default)
        {
            ConversationReads++;
            ConversationOffset = offset;
            return Task.FromResult(CommunicationResults.Success(new OperationConversationListData(
                [new OperationConversationData(OperationId, "DEV-OP-1", new DateOnly(2026, 9, 24),
                    "PUJ", "Demo Air", "Agent", "InProgress", null)], false)));
        }

        public Task<CommunicationResult<OperationMessageListData>> GetMessagesAsync(
            OperationalAccess access, Guid operationId, int offset, CancellationToken cancellationToken = default)
        {
            MessageOffset = offset;
            return Task.FromResult(CommunicationResults.Success(new OperationMessageListData(
                operationId, [], false)));
        }

        public Task<CommunicationResult<OperationPresenceContactsList>> GetPresenceParticipantsAsync(
            OperationalAccess access, IReadOnlyCollection<Guid> operationIds, CancellationToken cancellationToken = default) =>
            Task.FromResult(CommunicationResults.Success(new OperationPresenceContactsList(
                operationIds.Contains(OperationId) ? new[] { new OperationPresenceContacts(OperationId,
                    new[] { new PresenceIdentity(access.AccountId, "OCC Test", access.Role) }) } : Array.Empty<OperationPresenceContacts>())));

        public Task<CommunicationResult<OperationMessageData>> SendMessageAsync(
            SendOperationMessageCommand command, CancellationToken cancellationToken = default)
        {
            Sent = command;
            return Task.FromResult(CommunicationResults.Success(new OperationMessageData(
                Guid.NewGuid(), command.OperationId, command.Access.AccountId,
                command.Access.Role, "Agent Test", command.Content, Instant)));
        }

        public Task<CommunicationResult<OperationalNotificationListData>> GetNotificationsAsync(
            OperationalAccess access, CancellationToken cancellationToken = default) =>
            Task.FromResult(CommunicationResults.Success(new OperationalNotificationListData(
                [new OperationalNotificationData(NotificationId, OperationId,
                    "DEV-OP-1", "PUJ", "operation_submitted", Guid.NewGuid(), Instant, null)], false)));

        public Task<CommunicationResult<OperationalNotificationData>> SetNotificationReadAsync(
            OperationalAccess access, Guid notificationId, bool isRead,
            CancellationToken cancellationToken = default)
        {
            Marked = (access.AccountId, notificationId, isRead);
            return Task.FromResult(CommunicationResults.Success(new OperationalNotificationData(
                NotificationId, OperationId, "DEV-OP-1", "PUJ", "operation_submitted",
                Guid.NewGuid(), Instant, isRead ? Instant : null)));
        }
    }
}
