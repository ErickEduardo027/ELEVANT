using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Identity.CreateSession;

/// <summary>The safe outcome of attempting to create a session.</summary>
public sealed class CreateSessionResult
{
    private CreateSessionResult(SessionDetails? session, CreateSessionFailure? failure, LoginChallenge? challenge = null)
    {
        Session = session;
        Failure = failure;
        Challenge = challenge;
    }

    /// <summary>A portal login that must still confirm the code sent by email (ADR-0022).</summary>
    public LoginChallenge? Challenge { get; }

    /// <summary>The created session when <see cref="IsSuccess"/> is true.</summary>
    public SessionDetails? Session { get; }

    /// <summary>The non-sensitive failure category when no session was created.</summary>
    public CreateSessionFailure? Failure { get; }

    public bool IsSuccess => Session is not null;

    internal static CreateSessionResult Succeeded(SessionDetails session)
    {
        ArgumentNullException.ThrowIfNull(session);
        return new(session, null);
    }

    internal static CreateSessionResult Failed(CreateSessionFailure failure) => new(null, failure);

    internal static CreateSessionResult ChallengeIssued(LoginChallenge challenge) => new(null, null, challenge);
}

/// <summary>Session information returned only after every authentication gate succeeds.</summary>
public sealed record SessionDetails
{
    public SessionDetails(ActorContext actor, IssuedAccessToken accessToken, IssuedRefreshToken? refreshToken = null)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(accessToken);

        Actor = actor;
        AccessToken = accessToken;
        RefreshToken = refreshToken;
    }

    public ActorContext Actor { get; }

    public IssuedAccessToken AccessToken { get; }

    /// <summary>Renews the access token without asking for the password again (ADR-0021).</summary>
    public IssuedRefreshToken? RefreshToken { get; }

    /// <summary>Returns a diagnostic representation that omits identity data and credentials.</summary>
    public override string ToString() =>
        $"{nameof(SessionDetails)} {{ Actor = [REDACTED], AccessToken = [REDACTED], RefreshToken = [REDACTED] }}";
}

/// <summary>Failures deliberately avoid revealing whether an account exists.</summary>
public enum CreateSessionFailure
{
    InvalidCredentials,
    PasswordChangeRequired,
    TokenUnavailable,
}
