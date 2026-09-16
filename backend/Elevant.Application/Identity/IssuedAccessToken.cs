namespace Elevant.Application.Identity;

/// <summary>A signed bearer token and its absolute UTC expiration.</summary>
public sealed record IssuedAccessToken(string Value, DateTimeOffset ExpiresAt)
{
    /// <summary>Returns a diagnostic representation that never includes the bearer token.</summary>
    public override string ToString() =>
        $"{nameof(IssuedAccessToken)} {{ Value = [REDACTED], ExpiresAt = [REDACTED] }}";
}
