using System.Globalization;
using System.Text;

namespace Elevant.Domain.Reference;

public sealed record TerritoryMunicipality(string Code, string Name, IReadOnlyList<string> Districts);

public sealed record TerritoryProvince(string Code, string Name, IReadOnlyList<TerritoryMunicipality> Municipalities);

/// <summary>
/// Official territorial division of the Dominican Republic (DGII e-CF schema, adjusted to the
/// ONE 2021 municipality list): province → municipality → municipal district. The data lives
/// in the generated partial file; matching ignores case and accents.
/// </summary>
public static partial class DominicanTerritory
{
    /// <summary>Names the country may be stored with by the public form.</summary>
    private static readonly HashSet<string> CountryNames =
        new(["REPUBLICA DOMINICANA", "DOMINICAN REPUBLIC", "DO"], StringComparer.Ordinal);

    public static IReadOnlyList<TerritoryProvince> Provinces => Data;

    public static bool IsDominicanRepublic(string? country) =>
        country is not null && CountryNames.Contains(Key(country));

    public static TerritoryProvince? FindProvince(string? name) =>
        string.IsNullOrWhiteSpace(name) ? null : Data.FirstOrDefault(item => Key(item.Name) == Key(name));

    /// <summary>
    /// True when the province exists and, if given, the municipality belongs to it and the
    /// municipal district to that municipality. Empty levels below the first are allowed.
    /// </summary>
    public static bool IsValidLocation(string? province, string? municipality, string? district)
    {
        if (string.IsNullOrWhiteSpace(province))
            return string.IsNullOrWhiteSpace(municipality) && string.IsNullOrWhiteSpace(district);
        var found = FindProvince(province);
        if (found is null) return false;
        if (string.IsNullOrWhiteSpace(municipality)) return string.IsNullOrWhiteSpace(district);
        var place = found.Municipalities.FirstOrDefault(item => Key(item.Name) == Key(municipality));
        if (place is null) return false;
        return string.IsNullOrWhiteSpace(district) || place.Districts.Any(item => Key(item) == Key(district));
    }

    private static string Key(string value)
    {
        var decomposed = value.Trim().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var character in decomposed)
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
                builder.Append(char.ToUpperInvariant(character));
        return builder.ToString().Normalize(NormalizationForm.FormC);
    }
}
