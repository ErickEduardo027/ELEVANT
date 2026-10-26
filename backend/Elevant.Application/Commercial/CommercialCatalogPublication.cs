using System.Text.RegularExpressions;

namespace Elevant.Application.Commercial;

/// <summary>
/// What a service needs before airlines can see it in the public catalog: a real photo, a
/// description that explains it and a name that is not a test placeholder.
/// </summary>
public static partial class CommercialCatalogPublication
{
    public const int MinimumDescriptionLength = 20;

    [GeneratedRegex(@"\b(prueba|pruebas|test|testing|demo|ejemplo|dummy|asdf|xxx+)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Placeholder();

    /// <summary>Error code when the service cannot be published, or null when it can.</summary>
    public static string? Problem(string? code, string? name, string? description, string? imageUrl)
    {
        if (string.IsNullOrWhiteSpace(imageUrl)) return "image_required";
        if ((description?.Trim().Length ?? 0) < MinimumDescriptionLength) return "description_too_short";
        if (Placeholder().IsMatch(name ?? string.Empty) || Placeholder().IsMatch(code ?? string.Empty))
            return "placeholder_name";
        return null;
    }
}
