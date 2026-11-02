namespace Elevant.Application.Identity.AccountEmails;

/// <summary>Settings of the portal account emails (section <c>AccountEmail</c>, ADR-0022).</summary>
public sealed class AccountEmailOptions
{
    public const string SectionName = "AccountEmail";
    public const int MaximumCodeAttempts = 5;

    public static readonly TimeSpan ActivationLifetime = TimeSpan.FromHours(72);
    public static readonly TimeSpan LoginCodeLifetime = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan PasswordResetLifetime = TimeSpan.FromMinutes(30);

    /// <summary>Origin of the public portal used in activation and reset links, e.g. https://portal.example.</summary>
    public string? PublicWebBaseUrl { get; set; }

    /// <summary>Portal (airline) accounts confirm every login with a code sent by email.</summary>
    public bool RequireAirlineLoginCode { get; set; } = true;

    /// <summary>The link for a token, or null when the portal origin is not configured.</summary>
    public string? Link(string path, string token)
    {
        if (!Uri.TryCreate(PublicWebBaseUrl, UriKind.Absolute, out var origin) ||
            origin.Scheme is not ("https" or "http")) return null;
        return $"{origin.GetLeftPart(UriPartial.Authority)}{path}?token={Uri.EscapeDataString(token)}";
    }
}
