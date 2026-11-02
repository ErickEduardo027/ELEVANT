using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Identity.CreateSession;

/// <summary>Creates a Development session from credentials and server-authoritative actor scope.</summary>
public sealed class CreateSessionHandler(
    ICredentialVerifier credentialVerifier,
    IActorContextResolver actorContextResolver,
    IAccessTokenIssuer accessTokenIssuer,
    IRefreshTokenStore refreshTokens,
    TimeProvider timeProvider)
{
    public async Task<CreateSessionResult> HandleAsync(
        CreateSessionCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (string.IsNullOrWhiteSpace(command.Email) ||
            command.Email.Length > CreateSessionCommand.MaximumEmailLength ||
            string.IsNullOrWhiteSpace(command.Password) ||
            command.Password.Length > CreateSessionCommand.MaximumPasswordLength)
        {
            return CreateSessionResult.Failed(CreateSessionFailure.InvalidCredentials);
        }

        var verifiedCredential = await credentialVerifier.VerifyAsync(
            command.Email.Trim(),
            command.Password,
            cancellationToken);

        if (verifiedCredential is null || verifiedCredential.AccountId == Guid.Empty)
        {
            return CreateSessionResult.Failed(CreateSessionFailure.InvalidCredentials);
        }

        if (verifiedCredential.MustChangePassword)
        {
            return CreateSessionResult.Failed(CreateSessionFailure.PasswordChangeRequired);
        }

        var actor = await actorContextResolver.ResolveAsync(
            verifiedCredential.AccountId,
            cancellationToken);

        if (!ActorContextValidator.IsValid(actor, verifiedCredential.AccountId))
        {
            return CreateSessionResult.Failed(CreateSessionFailure.InvalidCredentials);
        }

        var accessToken = await accessTokenIssuer.IssueAsync(actor!, cancellationToken);
        if (accessToken is null ||
            string.IsNullOrWhiteSpace(accessToken.Value) ||
            accessToken.ExpiresAt <= timeProvider.GetUtcNow())
        {
            return CreateSessionResult.Failed(CreateSessionFailure.TokenUnavailable);
        }

        // Without a refresh token the session still works until the access token expires.
        var refreshToken = await refreshTokens.IssueAsync(actor!.AccountId, cancellationToken);
        return CreateSessionResult.Succeeded(new SessionDetails(actor, accessToken, refreshToken));
    }
}
