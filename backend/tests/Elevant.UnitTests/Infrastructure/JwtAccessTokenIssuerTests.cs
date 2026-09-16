using Elevant.Application.Identity;
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
        Assert.Contains(JwtRegisteredClaimNames.Iat, claimTypes);
        Assert.Contains(JwtRegisteredClaimNames.Nbf, claimTypes);
        Assert.Contains(JwtRegisteredClaimNames.Exp, claimTypes);
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

    private static JwtAccessTokenIssuer CreateIssuer(string signingKeyBase64 = SigningKeyBase64) => new(
        Options.Create(new JwtAccessTokenOptions
        {
            Issuer = Issuer,
            Audience = Audience,
            SigningKeyBase64 = signingKeyBase64,
        }),
        new FixedTimeProvider(Now));

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
