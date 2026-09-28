namespace Elevant.Persistence.Commercial;

/// <summary>Maps untouched Development fixture images to the revised service-specific assets.</summary>
internal static class CommercialServiceMediaDefaults
{
    private static readonly Dictionary<string, (string Legacy, string Current)> Images =
        new Dictionary<string, (string, string)>(StringComparer.Ordinal)
        {
            ["RAMP-CARGO"] = ("hero-ramp.webp", "cargo-loading.webp"),
            ["RAMP-TOW"] = ("turnaround-top.webp", "aircraft-towing.webp"),
            ["RAMP-AC"] = ("occ-control.webp", "ground-air-conditioning.webp"),
            ["RAMP-GPU"] = ("agent-rain.webp", "ground-power.webp"),
            ["RAMP-ASU"] = ("actor-airline.webp", "air-start-unit.webp"),
            ["RAMP-PARKING"] = ("closing-sunset.webp", "aircraft-marshalling.webp"),
            ["RAMP-STAIRS"] = ("hero-ramp.webp", "mobile-stairs.webp"),
        };

    public static string? Resolve(string code, string? imageUrl) =>
        Images.TryGetValue(code, out var image) &&
        imageUrl == $"/assets/generated/{image.Legacy}"
            ? $"/assets/services/{image.Current}" : imageUrl;
}
