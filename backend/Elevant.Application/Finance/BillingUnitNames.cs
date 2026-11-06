using System.Globalization;
using System.Text;

namespace Elevant.Application.Finance;

/// <summary>One billing unit of <c>ref.billing_units</c>: its stable code and its Spanish name.</summary>
public sealed record BillingUnitName(string Code, string Name);

/// <summary>
/// Billing units are stored by their code in the whole commercial cycle (1-E). Older catalog rows,
/// requests and drafts may carry the unit's Spanish name («operación») instead; this pure rule maps a
/// code or a name, in any casing and with or without accents, to the code of an active unit.
/// </summary>
public static class BillingUnitNames
{
    /// <summary>The unit a service falls back to when its stored text names no active unit.</summary>
    public const string DefaultCode = "operation";

    /// <summary>
    /// Code of the active unit <paramref name="text"/> names: an exact code first (case-insensitive),
    /// then a name compared without case or accents. Null when it names none.
    /// </summary>
    public static string? Resolve(string? text, IReadOnlyCollection<BillingUnitName> activeUnits)
    {
        ArgumentNullException.ThrowIfNull(activeUnits);
        var value = text?.Trim();
        if (string.IsNullOrEmpty(value)) return null;
        var byCode = activeUnits.FirstOrDefault(unit =>
            string.Equals(unit.Code, value, StringComparison.OrdinalIgnoreCase));
        if (byCode is not null) return byCode.Code;
        var folded = Fold(value);
        return activeUnits.FirstOrDefault(unit => Fold(unit.Name) == folded)?.Code;
    }

    /// <summary>
    /// Code for a new rate or request line: what <paramref name="text"/> names, else
    /// <see cref="DefaultCode"/> when it is active, else the first active code.
    /// </summary>
    public static string CodeOrDefault(string? text, IReadOnlyCollection<BillingUnitName> activeUnits) =>
        Resolve(text, activeUnits) ??
        Resolve(DefaultCode, activeUnits) ??
        activeUnits.Select(unit => unit.Code).Order(StringComparer.Ordinal).FirstOrDefault() ??
        DefaultCode;

    /// <summary>Lower case without accents or extra spaces: «Operación» and «operacion» are the same name.</summary>
    private static string Fold(string value)
    {
        var plain = new StringBuilder(value.Length);
        foreach (var character in value.Trim().Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) == UnicodeCategory.NonSpacingMark) continue;
            if (char.IsWhiteSpace(character))
            {
                if (plain.Length > 0 && plain[^1] != ' ') plain.Append(' ');
                continue;
            }
            plain.Append(char.ToLowerInvariant(character));
        }
        return plain.ToString().TrimEnd();
    }
}
