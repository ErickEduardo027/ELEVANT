using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Application.Identity.CreateSession;

namespace Elevant.UnitTests.Application;

public sealed class CreateSessionHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 16, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task ValidCredentialsCreateSessionFromResolvedActor()
    {
        string? verifiedEmail = null;
        string? verifiedPassword = null;
        var actor = IdentityTestData.CreateActor();
        var token = new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15));
        var verifier = new StubCredentialVerifier((email, password, _) =>
        {
            verifiedEmail = email;
            verifiedPassword = password;
            return Task.FromResult<VerifiedCredential?>(new(IdentityTestData.AccountId));
        });
        var resolver = new StubActorContextResolver((accountId, _) =>
        {
            Assert.Equal(IdentityTestData.AccountId, accountId);
            return Task.FromResult<ActorContext?>(actor);
        });
        var issuer = new StubAccessTokenIssuer((resolvedActor, _) =>
        {
            Assert.Same(actor, resolvedActor);
            return Task.FromResult<IssuedAccessToken?>(token);
        });
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand("  admin.occ@dev.elevant.test  ", " password-with-spaces "),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Failure);
        Assert.NotNull(result.Session);
        Assert.Same(actor, result.Session.Actor);
        Assert.Same(token, result.Session.AccessToken);
        Assert.Equal("admin.occ@dev.elevant.test", verifiedEmail);
        Assert.Equal(" password-with-spaces ", verifiedPassword);
        Assert.Equal(1, verifier.CallCount);
        Assert.Equal(1, resolver.CallCount);
        Assert.Equal(1, issuer.CallCount);
    }

    [Theory]
    [InlineData("", "password")]
    [InlineData("   ", "password")]
    [InlineData("user@dev.elevant.test", "")]
    [InlineData("user@dev.elevant.test", "   ")]
    public async Task MissingCredentialIsRejectedBeforeCallingPorts(string email, string password)
    {
        var verifier = new StubCredentialVerifier((_, _, _) =>
            Task.FromResult<VerifiedCredential?>(new(IdentityTestData.AccountId)));
        var resolver = StubActorContextResolver.Returning(IdentityTestData.CreateActor());
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand(email, password),
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Equal(CreateSessionFailure.InvalidCredentials, result.Failure);
        Assert.Null(result.Session);
        Assert.Equal(0, verifier.CallCount);
        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, issuer.CallCount);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UnverifiedCredentialIsRejectedWithoutResolvingActor(bool returnEmptyAccountId)
    {
        var verifier = new StubCredentialVerifier((_, _, _) =>
            Task.FromResult<VerifiedCredential?>(
                returnEmptyAccountId ? new VerifiedCredential(Guid.Empty) : null));
        var resolver = StubActorContextResolver.Returning(IdentityTestData.CreateActor());
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand("unknown@dev.elevant.test", "not-valid"),
            TestContext.Current.CancellationToken);

        Assert.Equal(CreateSessionFailure.InvalidCredentials, result.Failure);
        Assert.Equal(1, verifier.CallCount);
        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, issuer.CallCount);
    }

    [Fact]
    public async Task MissingActorIsReportedAsInvalidCredentialsWithoutIssuingToken()
    {
        var verifier = StubCredentialVerifier.Verified(IdentityTestData.AccountId);
        var resolver = StubActorContextResolver.Returning(null);
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand("disabled@dev.elevant.test", "password"),
            TestContext.Current.CancellationToken);

        Assert.Equal(CreateSessionFailure.InvalidCredentials, result.Failure);
        Assert.Equal(1, resolver.CallCount);
        Assert.Equal(0, issuer.CallCount);
    }

    [Fact]
    public async Task VerifiedTemporaryCredentialCannotResolveActorOrReceiveToken()
    {
        var verifier = new StubCredentialVerifier((_, _, _) =>
            Task.FromResult<VerifiedCredential?>(new(IdentityTestData.AccountId, true)));
        var resolver = StubActorContextResolver.Returning(IdentityTestData.CreateActor());
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));

        var result = await CreateHandler(verifier, resolver, issuer).HandleAsync(
            new CreateSessionCommand("temporary@dev.elevant.test", "valid-temporary-password"),
            TestContext.Current.CancellationToken);

        Assert.Equal(CreateSessionFailure.PasswordChangeRequired, result.Failure);
        Assert.Null(result.Session);
        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, issuer.CallCount);
    }

    [Fact]
    public async Task ActorForDifferentAccountIsRejectedWithoutIssuingToken()
    {
        var verifier = StubCredentialVerifier.Verified(IdentityTestData.AccountId);
        var resolver = StubActorContextResolver.Returning(IdentityTestData.CreateActor(Guid.NewGuid()));
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand("admin.occ@dev.elevant.test", "password"),
            TestContext.Current.CancellationToken);

        Assert.Equal(CreateSessionFailure.InvalidCredentials, result.Failure);
        Assert.Equal(0, issuer.CallCount);
    }

    [Fact]
    public async Task ActorWithoutEffectiveRolesIsRejectedWithoutIssuingToken()
    {
        var verifier = StubCredentialVerifier.Verified(IdentityTestData.AccountId);
        var actor = IdentityTestData.CreateActor() with { Roles = [] };
        var resolver = StubActorContextResolver.Returning(actor);
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand("admin.occ@dev.elevant.test", "password"),
            TestContext.Current.CancellationToken);

        Assert.Equal(CreateSessionFailure.InvalidCredentials, result.Failure);
        Assert.Equal(0, issuer.CallCount);
    }

    [Fact]
    public async Task ActorWithoutActiveMembershipIsRejectedWithoutIssuingToken()
    {
        var verifier = StubCredentialVerifier.Verified(IdentityTestData.AccountId);
        var actor = IdentityTestData.CreateActor() with { Memberships = [] };
        var resolver = StubActorContextResolver.Returning(actor);
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand("admin.occ@dev.elevant.test", "password"),
            TestContext.Current.CancellationToken);

        Assert.Equal(CreateSessionFailure.InvalidCredentials, result.Failure);
        Assert.Equal(0, issuer.CallCount);
    }

    [Fact]
    public async Task ActorMayHaveNoDirectStationScopes()
    {
        var verifier = StubCredentialVerifier.Verified(IdentityTestData.AccountId);
        var actor = IdentityTestData.CreateAirlineActor();
        var resolver = StubActorContextResolver.Returning(actor);
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);

        var result = await handler.HandleAsync(
            new CreateSessionCommand("airline.client@dev.elevant.test", "password"),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(actor, result.Session?.Actor);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task OversizedCredentialIsRejectedBeforeCallingPorts(bool oversizedEmail)
    {
        var verifier = StubCredentialVerifier.Verified(IdentityTestData.AccountId);
        var resolver = StubActorContextResolver.Returning(IdentityTestData.CreateActor());
        var issuer = StubAccessTokenIssuer.Returning(
            new IssuedAccessToken("signed.jwt.value", Now.AddMinutes(15)));
        var handler = CreateHandler(verifier, resolver, issuer);
        var email = oversizedEmail
            ? new string('a', CreateSessionCommand.MaximumEmailLength + 1)
            : "admin.occ@dev.elevant.test";
        var password = oversizedEmail
            ? "password"
            : new string('p', CreateSessionCommand.MaximumPasswordLength + 1);

        var result = await handler.HandleAsync(
            new CreateSessionCommand(email, password),
            TestContext.Current.CancellationToken);

        Assert.Equal(CreateSessionFailure.InvalidCredentials, result.Failure);
        Assert.Equal(0, verifier.CallCount);
        Assert.Equal(0, resolver.CallCount);
        Assert.Equal(0, issuer.CallCount);
    }

    [Fact]
    public void SecretBearingApplicationTypesRedactDiagnosticStrings()
    {
        const string email = "secret.user@dev.elevant.test";
        const string password = "not-for-logs";
        const string accessToken = "secret.jwt.value";
        var command = new CreateSessionCommand(email, password);
        var token = new IssuedAccessToken(accessToken, Now.AddMinutes(15));
        var session = new SessionDetails(IdentityTestData.CreateActor(), token);

        var diagnosticText = string.Join('|', command, token, session);

        Assert.DoesNotContain(email, diagnosticText, StringComparison.Ordinal);
        Assert.DoesNotContain(password, diagnosticText, StringComparison.Ordinal);
        Assert.DoesNotContain(accessToken, diagnosticText, StringComparison.Ordinal);
        Assert.Contains("[REDACTED]", diagnosticText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task MissingTokenNeverCreatesSession()
    {
        var result = await CreateSessionWithTokenAsync(null);

        Assert.False(result.IsSuccess);
        Assert.Equal(CreateSessionFailure.TokenUnavailable, result.Failure);
        Assert.Null(result.Session);
    }

    [Theory]
    [MemberData(nameof(UnusableTokens))]
    public async Task UnusableTokenNeverCreatesSession(IssuedAccessToken token)
    {
        var result = await CreateSessionWithTokenAsync(token);

        Assert.False(result.IsSuccess);
        Assert.Equal(CreateSessionFailure.TokenUnavailable, result.Failure);
        Assert.Null(result.Session);
    }

    private static async Task<CreateSessionResult> CreateSessionWithTokenAsync(
        IssuedAccessToken? token)
    {
        var verifier = StubCredentialVerifier.Verified(IdentityTestData.AccountId);
        var resolver = StubActorContextResolver.Returning(IdentityTestData.CreateActor());
        var issuer = StubAccessTokenIssuer.Returning(token);
        var handler = CreateHandler(verifier, resolver, issuer);

        return await handler.HandleAsync(
            new CreateSessionCommand("admin.occ@dev.elevant.test", "password"),
            TestContext.Current.CancellationToken);
    }

    public static TheoryData<IssuedAccessToken> UnusableTokens => new()
    {
        new IssuedAccessToken("", Now.AddMinutes(15)),
        new IssuedAccessToken("   ", Now.AddMinutes(15)),
        new IssuedAccessToken("signed.jwt.value", Now),
        new IssuedAccessToken("signed.jwt.value", Now.AddSeconds(-1)),
    };

    private static CreateSessionHandler CreateHandler(
        ICredentialVerifier verifier,
        IActorContextResolver resolver,
        IAccessTokenIssuer issuer) => new(verifier, resolver, issuer, new StubRefreshTokens(), new FixedTimeProvider(Now));

    private sealed class StubRefreshTokens : IRefreshTokenStore
    {
        public Task<IssuedRefreshToken?> IssueAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IssuedRefreshToken?>(new IssuedRefreshToken("refresh-" + accountId, Now.AddDays(30)));

        public Task<RefreshTokenRotation> RotateAsync(string token, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task RevokeFamilyAsync(string token, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class StubCredentialVerifier(
        Func<string, string, CancellationToken, Task<VerifiedCredential?>> callback)
        : ICredentialVerifier
    {
        public int CallCount { get; private set; }

        public async Task<VerifiedCredential?> VerifyAsync(
            string email,
            string password,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            return await callback(email, password, cancellationToken);
        }

        public static StubCredentialVerifier Verified(Guid accountId) => new((_, _, _) =>
            Task.FromResult<VerifiedCredential?>(new(accountId)));
    }

    private sealed class StubActorContextResolver(
        Func<Guid, CancellationToken, Task<ActorContext?>> callback)
        : IActorContextResolver
    {
        public int CallCount { get; private set; }

        public async Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            return await callback(accountId, cancellationToken);
        }

        public static StubActorContextResolver Returning(ActorContext? actor) => new((_, _) =>
            Task.FromResult(actor));
    }

    private sealed class StubAccessTokenIssuer(
        Func<ActorContext, CancellationToken, Task<IssuedAccessToken?>> callback)
        : IAccessTokenIssuer
    {
        public int CallCount { get; private set; }

        public async Task<IssuedAccessToken?> IssueAsync(
            ActorContext actor,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            return await callback(actor, cancellationToken);
        }

        public static StubAccessTokenIssuer Returning(IssuedAccessToken? token) => new((_, _) =>
            Task.FromResult(token));
    }
}
