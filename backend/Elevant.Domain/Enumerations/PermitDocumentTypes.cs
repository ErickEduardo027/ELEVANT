using System.Text.RegularExpressions;

namespace Elevant.Domain.Enumerations;

/// <summary>
/// The permit type codes a permit cycle keeps (ADR-0045): the two system types, defined here with their own rules,
/// and the custom types of the catalog (<c>ref.permit_document_types</c>), which count only where a stand requires them.
/// </summary>
public static partial class PermitDocumentTypes
{
    public const string AirportId = nameof(PermitDocumentType.AirportId);

    public const string RampDriverLicense = nameof(PermitDocumentType.RampDriverLicense);

    public const int CodeMaxLength = 32;

    public const int NameMaxLength = 160;

    public const int DescriptionMaxLength = 500;

    /// <summary>The system types in their stable order, with their Spanish names.</summary>
    public static readonly IReadOnlyList<(string Code, string Name)> System =
    [
        (AirportId, "Carnet aeroportuario"),
        (RampDriverLicense, "Licencia de conducir en rampa"),
    ];

    public static bool IsSystem(string? code) => code is AirportId or RampDriverLicense;

    /// <summary>The Spanish name of a system type; null for any other code.</summary>
    public static string? SystemName(string? code) => System.Where(item => item.Code == code)
        .Select(item => item.Name).FirstOrDefault();

    /// <summary>
    /// A custom code: 2 to 32 upper-case letters, digits or hyphens, starting with a letter or digit; null otherwise.
    /// The input is trimmed and upper-cased first. A system code (in any case) is never a custom code.
    /// </summary>
    public static string? CustomCode(string? value)
    {
        var code = value?.Trim().ToUpperInvariant();
        if (code is null || !CodePattern().IsMatch(code)) return null;
        return System.Any(item => string.Equals(item.Code, code, StringComparison.OrdinalIgnoreCase)) ? null : code;
    }

    [GeneratedRegex("^[A-Z0-9][A-Z0-9-]{1,31}$", RegexOptions.CultureInvariant)]
    private static partial Regex CodePattern();
}
