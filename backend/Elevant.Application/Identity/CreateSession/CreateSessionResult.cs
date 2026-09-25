namespace Elevant.Application.Identity.CreateSession;

/// <summary>The safe outcome of attempting to create a session.</summary>
public sealed class CreateSessionResult
{
    private CreateSessionResult(SessionDetails? session, CreateSessionFailure? failure)
    {
        Session = session;
        Failure = failure;
    }

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
}

/// <summary>Session information returned only after every authentication gate succeeds.</summary>
public sealed record SessionDetails
{
    public SessionDetails(ActorContext actor, IssuedAccessToken accessToken)
    {
        ArgumentNullException.ThrowIfNull(actor);
        ArgumentNullException.ThrowIfNull(accessToken);

        Actor = actor;
        AccessToken = accessToken;
    }

    public ActorContext Actor { get; }

    public IssuedAccessToken AccessToken { get; }

    /// <summary>Returns a diagnostic representation that omits identity data and credentials.</summary>
    public override string ToString() =>
        $"{nameof(SessionDetails)} {{ Actor = [REDACTED], AccessToken = [REDACTED] }}";
}

/// <summary>Failures deliberately avoid revealing whether an account exists.</summary>
public enum CreateSessionFailure
{
    InvalidCredentials,
    PasswordChangeRequired,
    TokenUnavailable,
}
