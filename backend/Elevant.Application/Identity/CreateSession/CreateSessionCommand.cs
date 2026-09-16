namespace Elevant.Application.Identity.CreateSession;

/// <summary>Credentials supplied to the session-creation use case.</summary>
public sealed record CreateSessionCommand(string Email, string Password)
{
    public const int MaximumEmailLength = 256;

    public const int MaximumPasswordLength = 256;

    /// <summary>Returns a diagnostic representation that never includes credentials.</summary>
    public override string ToString() =>
        $"{nameof(CreateSessionCommand)} {{ Email = [REDACTED], Password = [REDACTED] }}";
}
