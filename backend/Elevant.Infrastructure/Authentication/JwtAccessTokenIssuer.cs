using System.Security.Claims;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.Infrastructure.Authentication;

/// <summary>Issues a minimal signed JWT whose subject is resolved again by the server.</summary>
internal sealed class JwtAccessTokenIssuer(
    IOptions<JwtAccessTokenOptions> options,
    TimeProvider timeProvider,
    ISessionSecurityVersionStore securityVersionStore) : IAccessTokenIssuer
{
    private static readonly JsonWebTokenHandler TokenHandler = new();
    private readonly JwtAccessTokenOptions settings = options.Value;

    public async Task<IssuedAccessToken?> IssueAsync(
        ActorContext actor,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(actor);
        cancellationToken.ThrowIfCancellationRequested();

        if (!IsSafeActor(actor) ||
            !settings.IsValid() ||
            !settings.TryGetSigningKey(out var signingKey))
        {
            return null;
        }

        var securityStamp = await securityVersionStore.GetCurrentAsync(
            actor.AccountId, cancellationToken);
        if (string.IsNullOrWhiteSpace(securityStamp))
        {
            return null;
        }

        var issuedAt = timeProvider.GetUtcNow();
        var expiresAt = issuedAt.AddMinutes(settings.AccessTokenMinutes);
        var claims = new ClaimsIdentity(
        [
            new Claim(JwtRegisteredClaimNames.Sub, actor.AccountId.ToString("D")),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
            new Claim(SessionSecurityVersion.ClaimType, SessionSecurityVersion.Fingerprint(securityStamp)),
        ]);

        var descriptor = new SecurityTokenDescriptor
        {
            Audience = settings.Audience,
            Expires = expiresAt.UtcDateTime,
            IssuedAt = issuedAt.UtcDateTime,
            Issuer = settings.Issuer,
            NotBefore = issuedAt.UtcDateTime,
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(signingKey),
                SecurityAlgorithms.HmacSha256),
            Subject = claims,
            TokenType = "at+jwt",
        };

        var value = TokenHandler.CreateToken(descriptor);
        IssuedAccessToken token = new(value, expiresAt);
        return token;
    }

    private static bool IsSafeActor(ActorContext actor)
    {
        if (actor.AccountId == Guid.Empty ||
            string.IsNullOrWhiteSpace(actor.Email) ||
            string.IsNullOrWhiteSpace(actor.DisplayName) ||
            actor.Roles is null ||
            actor.Roles.Count == 0 ||
            actor.Memberships is null ||
            actor.Memberships.Count == 0 ||
            actor.StationScopes is null)
        {
            return false;
        }

        return actor.Roles.All(role =>
                   role is not null &&
                   role.RoleId != Guid.Empty &&
                   !string.IsNullOrWhiteSpace(role.Code) &&
                   !string.IsNullOrWhiteSpace(role.Name) &&
                   Enum.IsDefined(role.Portal) &&
                   !string.IsNullOrWhiteSpace(role.UserType)) &&
               actor.Memberships.All(membership =>
                   membership is not null &&
                   membership.MembershipId != Guid.Empty &&
                   membership.OrganizationId != Guid.Empty &&
                   !string.IsNullOrWhiteSpace(membership.OrganizationCode) &&
                   !string.IsNullOrWhiteSpace(membership.OrganizationName) &&
                   Enum.IsDefined(membership.OrganizationType) &&
                   Enum.IsDefined(membership.Kind)) &&
               actor.StationScopes.All(scope =>
                   scope is not null &&
                   scope.StationId != Guid.Empty &&
                   !string.IsNullOrWhiteSpace(scope.StationCode));
    }
}
