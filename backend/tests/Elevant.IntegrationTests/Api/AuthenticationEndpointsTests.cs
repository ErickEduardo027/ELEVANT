using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Contracts.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class AuthenticationEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private const string Email = "occ.operator@elevant.test";
    private const string Password = "CI-Only_AccountPassword!2026";
    private static readonly Guid AccountId = Guid.Parse("f84cb8b1-85cc-43ad-b671-45efc25c6532");

    [Fact]
    public async Task ValidCredentialsCreateMinimalTokenAndCurrentServerContext()
    {
        var state = new AuthenticationState();
        await using var application = CreateApplication(state);
        using var client = application.CreateClient();

        using var createResponse = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest(Email, Password),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, createResponse.StatusCode);
        AssertPrivateResponseHeaders(createResponse);
        var session = await createResponse.Content.ReadFromJsonAsync<SessionResponse>(
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.NotNull(session);
        Assert.Equal("Bearer", session.TokenType);
        Assert.Equal(AccountId, session.Actor.AccountId);
        Assert.Equal(SessionPortal.BackOffice, Assert.Single(session.Actor.Roles).Portal);
        Assert.Equal(
            SessionOrganizationType.AviamOperator,
            Assert.Single(session.Actor.Memberships).OrganizationType);

        var token = new JsonWebTokenHandler().ReadJsonWebToken(session.AccessToken);
        Assert.Equal("at+jwt", token.Typ);
        Assert.Equal(AccountId.ToString("D"), token.Subject);
        Assert.Equal(ElevantApiFactory.AuthenticationIssuer, token.Issuer);
        Assert.Contains(ElevantApiFactory.AuthenticationAudience, token.Audiences);
        Assert.DoesNotContain(token.Claims, claim => claim.Type is
            "email" or "name" or "role" or "roles" or "scope" or "station" or "organization");

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            session.AccessToken);

        using var currentResponse = await client.GetAsync(
            "/api/v1/auth/session",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, currentResponse.StatusCode);
        AssertPrivateResponseHeaders(currentResponse);
        var current = await currentResponse.Content.ReadFromJsonAsync<CurrentSessionResponse>(
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.NotNull(current);
        Assert.Equivalent(session.Actor, current.Actor, strict: true);
    }

    [Fact]
    public async Task TemporaryCredentialMustBeChangedBeforeAnySessionIsIssued()
    {
        var state = new AuthenticationState { MustChangePassword = true };
        await using var application = CreateApplication(state);
        using var client = application.CreateClient();

        using var blocked = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest(Email, Password),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode);
        AssertPrivateResponseHeaders(blocked);
        using var problem = await ReadJsonAsync(blocked);
        Assert.Equal("password_change_required", problem.RootElement.GetProperty("code").GetString());
        Assert.False(problem.RootElement.TryGetProperty("accessToken", out _));

        const string replacement = "New-Development-Password!2026";
        using var changed = await client.PostAsJsonAsync(
            "/api/v1/auth/password-change",
            new ChangePasswordRequest(Email, Password, replacement),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        AssertPrivateResponseHeaders(changed);

        using var oldCredential = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest(Email, Password),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, oldCredential.StatusCode);

        using var activated = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest(Email, replacement),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, activated.StatusCode);
    }

    [Fact]
    public async Task ChangingPasswordRevokesPreviouslyIssuedBearerToken()
    {
        var state = new AuthenticationState();
        await using var application = CreateApplication(state);
        using var client = application.CreateClient();
        var previousToken = await CreateAccessTokenAsync(client);

        using var changed = await client.PostAsJsonAsync(
            "/api/v1/auth/password-change",
            new ChangePasswordRequest(Email, Password, "Another-Development-Password!2026"),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, changed.StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", previousToken);

        using var revoked = await client.GetAsync(
            "/api/v1/auth/session", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
        Assert.Equal(1, state.ActorResolutionCount);
    }

    [Theory]
    [InlineData("unknown@elevant.test", Password)]
    [InlineData(Email, "Wrong-AccountPassword!2026")]
    public async Task InvalidCredentialsReturnTheSameGenericUnauthorizedProblem(
        string email,
        string password)
    {
        await using var application = CreateApplication(new AuthenticationState());
        using var client = application.CreateClient();

        using var response = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest(email, password),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponseHeaders(response);
        Assert.Empty(response.Headers.WwwAuthenticate);
        var document = await ReadJsonAsync(response);
        Assert.Equal("Authentication failed.", document.RootElement.GetProperty("title").GetString());
        Assert.False(document.RootElement.TryGetProperty("detail", out _));
    }

    [Fact]
    public async Task SessionCreationUsesTheStricterPerClientRateLimit()
    {
        await using var application = CreateApplication(new AuthenticationState())
            .WithWebHostBuilder(builder => builder.UseSetting("RateLimiting:SessionPermitLimit", "2"));
        using var client = application.CreateClient();

        foreach (var path in new[]
                 {
                     "/api/v1.0/auth/session",
                     "/api/v1/auth/session/",
                 })
        {
            using var unauthorized = await client.PostAsJsonAsync(
                path,
                new CreateSessionRequest("unknown@elevant.test", Password),
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        }

        using var limited = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest("unknown@elevant.test", Password),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        AssertPrivateResponseHeaders(limited);
    }

    [Fact]
    public async Task AutomaticValidationAndUnsupportedMediaResponsesAreNeverCached()
    {
        await using var application = CreateApplication(new AuthenticationState());
        using var client = application.CreateClient();

        using var invalid = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest("not-an-email", Password),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        AssertPrivateResponseHeaders(invalid);

        using var unsupported = await client.PostAsync(
            "/api/v1/auth/session",
            new StringContent("{}"),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, unsupported.StatusCode);
        AssertPrivateResponseHeaders(unsupported);
    }

    [Fact]
    public async Task OversizedCredentialBodyIsRejectedWithoutBeingCached()
    {
        await using var application = CreateApplication(new AuthenticationState());
        using var client = application.CreateClient();
        using var content = new StringContent(
            $"{{\"email\":\"admin@elevant.test\",\"password\":\"{new string('x', 5000)}\"}}",
            System.Text.Encoding.UTF8,
            "application/json");

        using var response = await client.PostAsync(
            "/api/v1/auth/session",
            content,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        AssertPrivateResponseHeaders(response);
    }

    [Theory]
    [InlineData("/hubs/operations/negotiate")]
    [InlineData("/hubs/notifications/negotiate")]
    public async Task QueryStringBearerTokenIsAcceptedOnlyForSignalRHubs(string hubPath)
    {
        await using var application = CreateApplication(new AuthenticationState());
        using var client = application.CreateClient();
        var accessToken = await CreateAccessTokenAsync(client);

        using var outsideHub = await client.GetAsync(
            $"/api/v1/auth/session?access_token={Uri.EscapeDataString(accessToken)}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, outsideHub.StatusCode);

        using var anonymousHub = await client.PostAsync(
            $"{hubPath}?negotiateVersion=1",
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousHub.StatusCode);

        using var hub = await client.PostAsync(
            $"{hubPath}?negotiateVersion=1&access_token={Uri.EscapeDataString(accessToken)}",
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, hub.StatusCode);
    }

    [Fact]
    public async Task CurrentSessionRequiresAValidBearerToken()
    {
        await using var application = CreateApplication(new AuthenticationState());
        using var client = application.CreateClient();

        using var response = await client.GetAsync(
            "/api/v1/auth/session",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponseHeaders(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task TamperedTokenIsRejectedBeforeTheUseCaseRuns()
    {
        var state = new AuthenticationState();
        await using var application = CreateApplication(state);
        using var client = application.CreateClient();
        var accessToken = await CreateAccessTokenAsync(client);
        var tokenSegments = accessToken.Split('.');
        Assert.Equal(3, tokenSegments.Length);
        var signature = tokenSegments[2].ToCharArray();
        var changedIndex = signature.Length / 2;
        signature[changedIndex] = signature[changedIndex] == 'A' ? 'B' : 'A';
        tokenSegments[2] = new string(signature);
        var tampered = string.Join('.', tokenSegments);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tampered);

        using var response = await client.GetAsync(
            "/api/v1/auth/session",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponseHeaders(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
        Assert.Equal(0, state.CurrentSessionResolutionCount);
    }

    [Theory]
    [InlineData(InvalidTokenKind.Expired)]
    [InlineData(InvalidTokenKind.WrongIssuer)]
    [InlineData(InvalidTokenKind.WrongAudience)]
    [InlineData(InvalidTokenKind.WrongType)]
    [InlineData(InvalidTokenKind.WrongAlgorithm)]
    [InlineData(InvalidTokenKind.MissingSubject)]
    [InlineData(InvalidTokenKind.InvalidSubject)]
    [InlineData(InvalidTokenKind.MissingTokenId)]
    [InlineData(InvalidTokenKind.InvalidTokenId)]
    [InlineData(InvalidTokenKind.DuplicateSubject)]
    [InlineData(InvalidTokenKind.DuplicateTokenId)]
    public async Task InvalidTokenMetadataIsRejectedBeforeTheUseCaseRuns(InvalidTokenKind kind)
    {
        var state = new AuthenticationState();
        await using var application = CreateApplication(state);
        using var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            CreateInvalidAccessToken(kind));

        using var response = await client.GetAsync(
            "/api/v1/auth/session",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponseHeaders(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
        Assert.Equal(0, state.CurrentSessionResolutionCount);
    }

    [Fact]
    public async Task CurrentSessionRejectsAnActorDisabledAfterTokenIssuance()
    {
        var state = new AuthenticationState();
        await using var application = CreateApplication(state);
        using var client = application.CreateClient();
        var accessToken = await CreateAccessTokenAsync(client);
        state.IsActorActive = false;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        using var response = await client.GetAsync(
            "/api/v1/auth/session",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponseHeaders(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
        Assert.Equal(2, state.ActorResolutionCount);
    }

    [Fact]
    public async Task RefreshTokenRenewsTheSessionRotatesAndEndsAtLogout()
    {
        var ct = TestContext.Current.CancellationToken;
        await using var application = CreateApplication(new AuthenticationState());
        using var client = application.CreateClient();
        using var login = await client.PostAsJsonAsync("/api/v1/auth/session", new CreateSessionRequest(Email, Password), ct);
        var session = (await login.Content.ReadFromJsonAsync<SessionResponse>(cancellationToken: ct))!;
        Assert.False(string.IsNullOrEmpty(session.RefreshToken));
        Assert.NotNull(session.RefreshExpiresAt);

        using var refreshed = await client.PostAsJsonAsync("/api/v1/auth/session/refresh",
            new RefreshSessionRequest(session.RefreshToken!), ct);
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        AssertPrivateResponseHeaders(refreshed);
        var renewed = (await refreshed.Content.ReadFromJsonAsync<SessionResponse>(cancellationToken: ct))!;
        Assert.NotEqual(session.RefreshToken, renewed.RefreshToken);
        Assert.Equal(AccountId, renewed.Actor.AccountId);

        using var rotated = await client.PostAsJsonAsync("/api/v1/auth/session/refresh",
            new RefreshSessionRequest(session.RefreshToken!), ct);
        Assert.Equal(HttpStatusCode.Conflict, rotated.StatusCode);
        Assert.Contains("refresh_rotated", await rotated.Content.ReadAsStringAsync(ct));

        using var logout = await client.PostAsJsonAsync("/api/v1/auth/session/logout",
            new RefreshSessionRequest(renewed.RefreshToken!), ct);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        using var afterLogout = await client.PostAsJsonAsync("/api/v1/auth/session/refresh",
            new RefreshSessionRequest(renewed.RefreshToken!), ct);
        Assert.Equal(HttpStatusCode.Unauthorized, afterLogout.StatusCode);
    }

    /// <summary>Rotation semantics without SQL; the SQL store has its own integration test.</summary>
    private sealed class InMemoryRefreshTokens : IRefreshTokenStore
    {
        private readonly Dictionary<string, (Guid Account, Guid Family, bool Rotated, bool Revoked)> tokens = [];

        public Task<IssuedRefreshToken?> IssueAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IssuedRefreshToken?>(Add(accountId, Guid.NewGuid()));

        public Task<RefreshTokenRotation> RotateAsync(string token, CancellationToken cancellationToken = default)
        {
            lock (tokens)
            {
                if (!tokens.TryGetValue(token, out var entry) || entry.Revoked)
                    return Task.FromResult(new RefreshTokenRotation(null, null, RefreshTokenFailure.Invalid));
                if (entry.Rotated)
                    return Task.FromResult(new RefreshTokenRotation(null, null, RefreshTokenFailure.AlreadyRotated));
                tokens[token] = entry with { Rotated = true };
                return Task.FromResult(new RefreshTokenRotation(entry.Account, Add(entry.Account, entry.Family), null));
            }
        }

        public Task RevokeFamilyAsync(string token, CancellationToken cancellationToken = default)
        {
            lock (tokens)
                if (tokens.TryGetValue(token, out var entry))
                    foreach (var key in tokens.Where(item => item.Value.Family == entry.Family).Select(item => item.Key).ToArray())
                        tokens[key] = tokens[key] with { Revoked = true };
            return Task.CompletedTask;
        }

        private IssuedRefreshToken Add(Guid account, Guid family)
        {
            var value = Guid.NewGuid().ToString("N");
            lock (tokens) tokens[value] = (account, family, false, false);
            return new IssuedRefreshToken(value, DateTimeOffset.UtcNow.AddDays(30));
        }
    }

    private WebApplicationFactory<Program> CreateApplication(AuthenticationState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ICredentialVerifier>();
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<ISessionSecurityVersionStore>();
            services.RemoveAll<IPasswordChangeStore>();
            services.RemoveAll<IRefreshTokenStore>();
            services.AddSingleton(state);
            services.AddSingleton<IRefreshTokenStore>(new InMemoryRefreshTokens());
            services.AddScoped<ICredentialVerifier>(_ => new StubCredentialVerifier(state));
            services.AddScoped<IActorContextResolver>(_ => new StubActorContextResolver(state));
            services.AddScoped<ISessionSecurityVersionStore>(_ => new StubSecurityVersionStore(state));
            services.AddScoped<IPasswordChangeStore>(_ => new StubPasswordChangeStore(state));
        }));

    private static async Task<string> CreateAccessTokenAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            "/api/v1/auth/session",
            new CreateSessionRequest(Email, Password),
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var session = await response.Content.ReadFromJsonAsync<SessionResponse>(
            cancellationToken: TestContext.Current.CancellationToken);
        return Assert.IsType<SessionResponse>(session).AccessToken;
    }

    private static string CreateInvalidAccessToken(InvalidTokenKind kind)
    {
        var now = DateTimeOffset.UtcNow;
        var expiresAt = kind == InvalidTokenKind.Expired
            ? now.AddMinutes(-2)
            : now.AddMinutes(15);
        var signingKey = new SymmetricSecurityKey(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        var descriptor = new SecurityTokenDescriptor
        {
            Audience = kind == InvalidTokenKind.WrongAudience
                ? "unexpected-audience"
                : ElevantApiFactory.AuthenticationAudience,
            Expires = expiresAt.UtcDateTime,
            IssuedAt = now.AddMinutes(-10).UtcDateTime,
            Issuer = kind == InvalidTokenKind.WrongIssuer
                ? "unexpected-issuer"
                : ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddMinutes(-10).UtcDateTime,
            SigningCredentials = new SigningCredentials(
                signingKey,
                kind == InvalidTokenKind.WrongAlgorithm
                    ? SecurityAlgorithms.HmacSha384
                    : SecurityAlgorithms.HmacSha256),
            Subject = new ClaimsIdentity(CreateIdentityClaims(kind)),
            TokenType = kind == InvalidTokenKind.WrongType ? "JWT" : "at+jwt",
        };

        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    private static IEnumerable<Claim> CreateIdentityClaims(InvalidTokenKind kind)
    {
        if (kind != InvalidTokenKind.MissingSubject)
        {
            yield return new Claim(
                JwtRegisteredClaimNames.Sub,
                kind == InvalidTokenKind.InvalidSubject ? "not-a-guid" : AccountId.ToString("D"));
        }

        if (kind == InvalidTokenKind.DuplicateSubject)
        {
            yield return new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString("D"));
        }

        if (kind != InvalidTokenKind.MissingTokenId)
        {
            yield return new Claim(
                JwtRegisteredClaimNames.Jti,
                kind == InvalidTokenKind.InvalidTokenId ? "not-a-guid" : Guid.NewGuid().ToString("D"));
        }

        if (kind == InvalidTokenKind.DuplicateTokenId)
        {
            yield return new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D"));
        }

        yield return new Claim(
            SessionSecurityVersion.ClaimType,
            SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp));
    }

    private static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(
            TestContext.Current.CancellationToken);
        return await JsonDocument.ParseAsync(
            stream,
            cancellationToken: TestContext.Current.CancellationToken);
    }

    private static void AssertPrivateResponseHeaders(HttpResponseMessage response)
    {
        Assert.Contains("no-store", response.Headers.CacheControl?.ToString(), StringComparison.Ordinal);
        Assert.Contains("no-cache", response.Headers.Pragma.Select(value => value.Name));
    }

    private sealed class AuthenticationState
    {
        public bool IsActorActive { get; set; } = true;

        public bool MustChangePassword { get; set; }

        public string Password { get; set; } = AuthenticationEndpointsTests.Password;

        public string SecurityStamp { get; set; } = ElevantApiFactory.TestSecurityStamp;

        public int ActorResolutionCount { get; set; }

        public int CurrentSessionResolutionCount => Math.Max(0, ActorResolutionCount - 1);
    }

    public enum InvalidTokenKind
    {
        Expired,
        WrongIssuer,
        WrongAudience,
        WrongType,
        WrongAlgorithm,
        MissingSubject,
        InvalidSubject,
        MissingTokenId,
        InvalidTokenId,
        DuplicateSubject,
        DuplicateTokenId,
    }

    private sealed class StubCredentialVerifier(AuthenticationState state) : ICredentialVerifier
    {
        public Task<VerifiedCredential?> VerifyAsync(
            string email,
            string password,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            VerifiedCredential? credential = state.IsActorActive &&
                string.Equals(email, Email, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(password, state.Password, StringComparison.Ordinal)
                    ? new VerifiedCredential(AccountId, state.MustChangePassword)
                    : null;
            return Task.FromResult(credential);
        }
    }

    private sealed class StubSecurityVersionStore(AuthenticationState state) : ISessionSecurityVersionStore
    {
        public Task<string?> GetCurrentAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(accountId == AccountId && !state.MustChangePassword
                ? state.SecurityStamp
                : null);
    }

    private sealed class StubPasswordChangeStore(AuthenticationState state) : IPasswordChangeStore
    {
        public Task<PasswordChangeOutcome> ChangeAsync(
            Guid accountId,
            string currentPassword,
            string newPassword,
            CancellationToken cancellationToken = default)
        {
            if (accountId != AccountId || currentPassword != state.Password)
            {
                return Task.FromResult(PasswordChangeOutcome.InvalidCredentials);
            }

            state.Password = newPassword;
            state.MustChangePassword = false;
            state.SecurityStamp = Guid.NewGuid().ToString("D");
            return Task.FromResult(PasswordChangeOutcome.Succeeded);
        }
    }

    private sealed class StubActorContextResolver(AuthenticationState state) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            state.ActorResolutionCount++;
            ActorContext? actor = state.IsActorActive && accountId == AccountId
                ? CreateActor()
                : null;
            return Task.FromResult(actor);
        }
    }

    private static ActorContext CreateActor() => new(
        AccountId: AccountId,
        Email: Email,
        DisplayName: "OCC Operator",
        Roles:
        [
            new ActorRole(
                RoleId: Guid.Parse("f27148b8-aa5a-4b70-b83c-59902d354395"),
                Code: "OCC_OPERATOR",
                Name: "OCC Operator",
                Portal: PortalKind.BackOffice,
                UserType: "InternalStaff"),
        ],
        Memberships:
        [
            new ActorMembership(
                MembershipId: Guid.Parse("072dd388-c5e8-4c07-acf2-55b197523c4a"),
                OrganizationId: Guid.Parse("f7802911-c8f8-4393-a28f-9d76213fd606"),
                OrganizationCode: "AVIAM",
                OrganizationName: "AVIAM",
                OrganizationType: OrganizationType.AviamOperator,
                Kind: MembershipKind.InternalStaff),
        ],
        StationScopes:
        [
            new ActorStationScope(
                StationId: Guid.Parse("9762231e-bdda-47ef-85b8-7d70e2425712"),
                StationCode: "SDQ"),
        ]);
}
