namespace Elevant.Infrastructure.Integrations.OpenSky;

/// <summary>Server-only licensed provider configuration.</summary>
public sealed class OpenSkyOptions
{
    public const string SectionName = "OpenSky";
    public bool Enabled { get; set; }
    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
}
