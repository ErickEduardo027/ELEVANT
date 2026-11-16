namespace Elevant.Infrastructure.Authentication;

/// <summary>Server-owned settings used to sign short-lived access tokens.</summary>
public sealed class JwtAccessTokenOptions
{
    /// <summary>Configuration section containing JWT settings.</summary>
    public const string SectionName = "Authentication";

    /// <summary>Expected token issuer.</summary>
    public string? Issuer { get; set; }

    /// <summary>Expected token audience.</summary>
    public string? Audience { get; set; }

    /// <summary>Base64-encoded symmetric signing material supplied by the secret store.</summary>
    public string? SigningKeyBase64 { get; set; }

    /// <summary>Lifetime of an issued access token in minutes.</summary>
    public int AccessTokenMinutes { get; set; } = 15;

    /// <summary>Returns whether all issuer, audience, lifetime and key settings are safe.</summary>
    public bool IsValid() =>
        !string.IsNullOrWhiteSpace(Issuer) &&
        !string.IsNullOrWhiteSpace(Audience) &&
        AccessTokenMinutes is >= 1 and <= 60 &&
        TryGetSigningKey(out _);

    /// <summary>Decodes validated key material without accepting placeholders or whitespace.</summary>
    public bool TryGetSigningKey(out byte[] signingKey)
    {
        signingKey = [];
        if (string.IsNullOrWhiteSpace(SigningKeyBase64) ||
            SigningKeyBase64.Length > 256 ||
            SigningKeyBase64.Any(char.IsWhiteSpace))
        {
            return false;
        }

        try
        {
            signingKey = Convert.FromBase64String(SigningKeyBase64);
            return signingKey.Length is >= 32 and <= 128;
        }
        catch (FormatException)
        {
            signingKey = [];
            return false;
        }
    }
}
