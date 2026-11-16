namespace Elevant.Infrastructure.Integrations.FlightAware;

/// <summary>Configuration placeholder for a future FlightAware adapter.</summary>
public sealed class FlightAwareOptions
{
    /// <summary>Configuration section name.</summary>
    public const string SectionName = "FlightAware";

    /// <summary>Gets or sets the vendor base address when an adapter is implemented.</summary>
    public string? BaseUrl { get; set; }

    /// <summary>Gets or sets the vendor credential supplied only through secret configuration.</summary>
    public string? ApiKey { get; set; }
}
