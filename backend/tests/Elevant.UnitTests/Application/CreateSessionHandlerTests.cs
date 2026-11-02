using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Application.Identity.CreateSession;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class CreateSessionHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 16, 12, 0, 0, TimeSpan.Zero);

    private static ActorContext PortalActor() => IdentityTestData.CreateActor() with
    {
        Roles = [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000003"), "AIRLINE_CLIENT", "Airline client",
            PortalKind.AirlinePortal, "airline_client")],
        Memberships = [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000003"),
            Guid.Parse("43000000-0000-7000-8000-000000000003"), "DEMO-AIR", "Demo Air",
            OrganizationType.AirlineCustomer, MembershipKind.AirlineClient)],
        StationScopes = [],
    };

    [Fact]
    public async Task PortalAccountsGetAnEmailChallengeInsteadOfATokenAndTheCodeCompletesTheLogin()
    {
        var emails = new StubAccountEmails();
        var issued = 0;
        var handler = CreateHandler(
            new StubCredentialVerifier((_, _, _) => Task.FromResult<VerifiedCredential?>(new(IdentityTestData.AccountId))),
            new StubActorContextResolver((_, _) => Task.FromResult<ActorContext?>(PortalActor())),
            new StubAccessTokenIssuer((_, _) =>
            {
                issued++;
                return Task.FromResult<IssuedAccessToken?>(new("signed.jwt.value", Now.AddMinutes(15)));
            }),
            emails);

        var started = await handler.HandleAsync(new CreateSessionCommand("airline@example.test", "Synthetic-Password!2026"),
            TestContext.Current.CancellationToken);
        Assert.False(started.IsSuccess);
        Assert.Equal(StubAccountEmails.Challenge, started.Challenge!.ChallengeId);
        Assert.Equal(0, issued);

        Assert.False((await handler.VerifyCodeAsync(StubAccountEmails.Challenge, "000000", TestContext.Current.CancellationToken)).IsSuccess);
        Assert.False((await handler.VerifyCodeAsync(StubAccountEmails.Challenge, "12345a", TestContext.Current.CancellationToken)).IsSuccess);
        var completed = await handler.VerifyCodeAsync(StubAccountEmails.Challenge, "123456", TestContext.Current.CancellationToken);
        Assert.True(completed.IsSuccess);
        Assert.Equal(1, issued);
        Assert.NotNull(completed.Session!.RefreshToken);
    }

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

        // A valid airline actor with no direct stations reaches the email code step (ADR-0022).
        Assert.Null(result.Failure);
        Assert.NotNull(result.Challenge);
        var completed = await handler.VerifyCodeAsync(result.Challenge!.ChallengeId, "123456",
            TestContext.Current.CancellationToken);
        Assert.Same(actor, completed.Session?.Actor);
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
        IAccessTokenIssuer issuer, StubAccountEmails? emails = null) => new(verifier, resolver, issuer, new StubRefreshTokens(),
        emails ?? new StubAccountEmails(), new AccountEmailOptions(), new FixedTimeProvider(Now));

    private sealed class StubAccountEmails : IAccountEmailStore
    {
        public static readonly Guid Challenge = Guid.Parse("7a000000-0000-7000-8000-000000000001");
        public int Issued { get; private set; }

        public Task<LoginChallenge?> IssueLoginCodeAsync(Guid accountId, CancellationToken cancellationToken = default)
        {
            Issued++;
            return Task.FromResult<LoginChallenge?>(new LoginChallenge(Challenge, "a••••z@example.test", Now.AddMinutes(10)));
        }

        public Task<LoginChallenge?> ResendLoginCodeAsync(Guid challengeId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<AccountEmailResult> VerifyLoginCodeAsync(Guid challengeId, string code, CancellationToken cancellationToken = default) =>
            Task.FromResult(challengeId == Challenge && code == "123456"
                ? new AccountEmailResult(IdentityTestData.AccountId, null)
                : new AccountEmailResult(null, AccountEmailFailure.Invalid));

        public Task<AccountEmailResult> ActivateAsync(string token, string newPassword, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task RequestPasswordResetAsync(string email, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<AccountEmailResult> ResetPasswordAsync(string token, string newPassword, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

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
