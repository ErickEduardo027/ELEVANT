using System.Text.Json;
using Elevant.Application.Identity;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Authentication;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.UnitTests.Infrastructure;

public sealed class JwtAccessTokenIssuerTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 16, 12, 0, 0, TimeSpan.Zero);
    private const string Issuer = "https://api.dev.elevant.test";
    private const string Audience = "elevant-development-clients";
    private const string SigningKeyBase64 =
        "RUxFVkFOVCBzeW50aGV0aWMgc2lnbmluZyBtYXRlcmlhbCBmb3IgdGVzdHMgb25seSAyMDI2LTA5LTE2";

    [Fact]
    public async Task ValidActorReceivesSignedMinimalToken()
    {
        var issuer = CreateIssuer();

        var issued = await issuer.IssueAsync(
            CreateActor(),
            TestContext.Current.CancellationToken);

        Assert.NotNull(issued);
        Assert.Equal(Now.AddMinutes(15), issued.ExpiresAt);

        var token = new JsonWebToken(issued.Value);
        Assert.Equal(Issuer, token.Issuer);
        Assert.Contains(Audience, token.Audiences);
        Assert.Equal(AccountId.ToString("D"), token.Subject);
        Assert.False(string.IsNullOrWhiteSpace(token.Id));
        Assert.Equal("HS256", token.Alg);
        Assert.Equal("at+jwt", token.Typ);

        var claimTypes = token.Claims.Select(claim => claim.Type).ToHashSet(StringComparer.Ordinal);
        Assert.Contains(JwtRegisteredClaimNames.Sub, claimTypes);
        Assert.Contains(JwtRegisteredClaimNames.Jti, claimTypes);
        Assert.Contains(SessionSecurityVersion.ClaimType, claimTypes);
        Assert.Contains(JwtRegisteredClaimNames.Iat, claimTypes);
        Assert.Contains(JwtRegisteredClaimNames.Nbf, claimTypes);
        Assert.Contains(JwtRegisteredClaimNames.Exp, claimTypes);
        // A sign-in starts the session (ADR-0046).
        Assert.Equal(Now.ToUnixTimeSeconds(), AuthTime(issued.Value));
        Assert.Equal(Now.ToUnixTimeSeconds(), IssuedAt(issued.Value));
        Assert.DoesNotContain("email", claimTypes);
        Assert.DoesNotContain("name", claimTypes);
        Assert.DoesNotContain("role", claimTypes);
        Assert.DoesNotContain("elevant:organization", claimTypes);
        Assert.DoesNotContain("elevant:station", claimTypes);

        var validation = await new JsonWebTokenHandler().ValidateTokenAsync(
            issued.Value,
            new TokenValidationParameters
            {
                ValidIssuer = Issuer,
                ValidAudience = Audience,
                IssuerSigningKey = new SymmetricSecurityKey(Convert.FromBase64String(SigningKeyBase64)),
                RequireSignedTokens = true,
                ValidateAudience = true,
                ValidateIssuer = true,
                ValidateIssuerSigningKey = true,
                ValidateLifetime = false,
                ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                ValidTypes = ["at+jwt"],
            });

        Assert.True(validation.IsValid, validation.Exception?.Message);
    }

    /// <summary>
    /// ADR-0046: a renewed token carries when its session began (<c>auth_time</c>), the same in every renewal and
    /// never later than the token itself (<c>iat</c>).
    /// </summary>
    [Fact]
    public async Task ARenewedTokenKeepsWhenItsSessionBegan()
    {
        var ct = TestContext.Current.CancellationToken;
        var signedIn = Now.AddMilliseconds(750);

        var first = await CreateIssuer(now: Now.AddMinutes(16)).IssueAsync(CreateActor(), signedIn, ct);
        var second = await CreateIssuer(now: Now.AddHours(9)).IssueAsync(CreateActor(), signedIn, ct);

        Assert.NotNull(first);
        Assert.NotNull(second);
        Assert.Equal(Now.AddMinutes(31), first.ExpiresAt);
        Assert.Equal(Now.ToUnixTimeSeconds(), AuthTime(first.Value));
        Assert.Equal(Now.ToUnixTimeSeconds(), AuthTime(second.Value));
        Assert.Equal(Now.AddMinutes(16).ToUnixTimeSeconds(), IssuedAt(first.Value));
        Assert.Equal(Now.AddHours(9).ToUnixTimeSeconds(), IssuedAt(second.Value));

        // A session start the issuer has not reached yet (another instance's clock) never dates the token ahead.
        var ahead = await CreateIssuer().IssueAsync(CreateActor(), Now.AddMinutes(2), ct);
        Assert.Equal(IssuedAt(ahead!.Value), AuthTime(ahead.Value));
        // Without a session start the token starts one, as a sign-in does.
        var fresh = await CreateIssuer().IssueAsync(CreateActor(), null, ct);
        Assert.Equal(Now.ToUnixTimeSeconds(), AuthTime(fresh!.Value));
    }

    [Fact]
    public async Task ActorWithoutEffectiveMembershipDoesNotReceiveToken()
    {
        var actor = CreateActor() with { Memberships = [] };

        var issued = await CreateIssuer().IssueAsync(
            actor,
            TestContext.Current.CancellationToken);

        Assert.Null(issued);
    }

    [Theory]
    [InlineData("REPLACE_ME")]
    [InlineData("MDEyMzQ1Njc4OWFiY2RlZg==")]
    [InlineData(SigningKeyBase64 + " ")]
    public async Task InvalidSigningKeyDoesNotProduceToken(string signingKeyBase64)
    {
        var issuer = CreateIssuer(signingKeyBase64);

        var issued = await issuer.IssueAsync(
            CreateActor(),
            TestContext.Current.CancellationToken);

        Assert.Null(issued);
    }

    private static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000001");

    private static JwtAccessTokenIssuer CreateIssuer(string signingKeyBase64 = SigningKeyBase64,
        DateTimeOffset? now = null) => new(
        Options.Create(new JwtAccessTokenOptions
        {
            Issuer = Issuer,
            Audience = Audience,
            SigningKeyBase64 = signingKeyBase64,
        }),
        new FixedTimeProvider(now ?? Now),
        new StubSecurityVersionStore());

    /// <summary>The token's <c>auth_time</c>, which must be a JSON NumericDate (Unix seconds).</summary>
    private static long AuthTime(string token) => NumericDate(token, JwtRegisteredClaimNames.AuthTime);

    private static long IssuedAt(string token) => NumericDate(token, JwtRegisteredClaimNames.Iat);

    private static long NumericDate(string token, string claim)
    {
        using var payload = JsonDocument.Parse(Base64UrlEncoder.Decode(new JsonWebToken(token).EncodedPayload));
        Assert.True(payload.RootElement.TryGetProperty(claim, out var value), $"The token has no {claim}.");
        Assert.Equal(JsonValueKind.Number, value.ValueKind);
        return value.GetInt64();
    }

    private sealed class StubSecurityVersionStore : ISessionSecurityVersionStore
    {
        public Task<string?> GetCurrentAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(accountId == AccountId ? "unit-test-security-stamp" : null);
    }

    private static ActorContext CreateActor() => new(
        AccountId,
        "admin.occ@dev.elevant.test",
        "Avery Operations",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000001"),
                "ADMIN_OCC",
                "Admin OCC",
                PortalKind.BackOffice,
                "admin_occ"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000001"),
                Guid.Parse("43000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [
            new ActorStationScope(
                Guid.Parse("44000000-0000-7000-8000-000000000001"),
                "SDQ"),
        ]);

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
