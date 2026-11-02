using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Identity.CreateSession;

/// <summary>
/// Creates a session from credentials and server-authoritative actor scope. Portal (airline)
/// accounts also confirm a code sent to their email before any token is issued (ADR-0022).
/// </summary>
public sealed class CreateSessionHandler(
    ICredentialVerifier credentialVerifier,
    IActorContextResolver actorContextResolver,
    IAccessTokenIssuer accessTokenIssuer,
    IRefreshTokenStore refreshTokens,
    IAccountEmailStore accountEmails,
    AccountEmailOptions emailOptions,
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

        if (emailOptions.RequireAirlineLoginCode && IsPortalAccount(actor!))
        {
            var challenge = await accountEmails.IssueLoginCodeAsync(actor!.AccountId, cancellationToken);
            return challenge is null
                ? CreateSessionResult.Failed(CreateSessionFailure.InvalidCredentials)
                : CreateSessionResult.ChallengeIssued(challenge);
        }

        return await IssueAsync(actor!, cancellationToken);
    }

    /// <summary>Completes a portal login with the code the account received by email.</summary>
    public async Task<CreateSessionResult> VerifyCodeAsync(Guid challengeId, string? code,
        CancellationToken cancellationToken = default)
    {
        if (challengeId == Guid.Empty || code is null || code.Length != 6 || !code.All(char.IsAsciiDigit))
            return CreateSessionResult.Failed(CreateSessionFailure.InvalidCredentials);
        var verified = await accountEmails.VerifyLoginCodeAsync(challengeId, code, cancellationToken);
        if (!verified.IsSuccess) return CreateSessionResult.Failed(CreateSessionFailure.InvalidCredentials);
        var actor = await actorContextResolver.ResolveAsync(verified.AccountId!.Value, cancellationToken);
        return ActorContextValidator.IsValid(actor, verified.AccountId.Value)
            ? await IssueAsync(actor!, cancellationToken)
            : CreateSessionResult.Failed(CreateSessionFailure.InvalidCredentials);
    }

    private static bool IsPortalAccount(ActorContext actor) =>
        actor.Roles.Any(role => role.Portal == PortalKind.AirlinePortal);

    private async Task<CreateSessionResult> IssueAsync(ActorContext actor, CancellationToken cancellationToken)
    {
        var accessToken = await accessTokenIssuer.IssueAsync(actor, cancellationToken);
        if (accessToken is null ||
            string.IsNullOrWhiteSpace(accessToken.Value) ||
            accessToken.ExpiresAt <= timeProvider.GetUtcNow())
        {
            return CreateSessionResult.Failed(CreateSessionFailure.TokenUnavailable);
        }

        // Without a refresh token the session still works until the access token expires.
        var refreshToken = await refreshTokens.IssueAsync(actor.AccountId, cancellationToken);
        return CreateSessionResult.Succeeded(new SessionDetails(actor, accessToken, refreshToken));
    }
}
