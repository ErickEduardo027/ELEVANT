namespace Elevant.Domain.Validation;

/// <summary>
/// Phone numbers as people type them, stored in E.164. Dominican numbers (809, 829, 849)
/// are accepted with or without the country code and with any spacing, dashes or brackets;
/// numbers from other countries must carry their international prefix (+ or 00).
/// </summary>
public static class PhoneNumbers
{
    public static IReadOnlyList<string> DominicanAreaCodes { get; } = ["809", "829", "849"];

    /// <summary>Returns the E.164 form (e.g. +18492463371) or null when the value is not a usable phone.</summary>
    public static string? Normalize(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var value = input.Trim();
        if (value.Length > 32) return null;

        var international = false;
        if (value.StartsWith('+'))
        {
            international = true;
            value = value[1..];
        }
        else if (value.StartsWith("00", StringComparison.Ordinal))
        {
            international = true;
            value = value[2..];
        }

        var digits = new char[value.Length];
        var count = 0;
        foreach (var character in value)
        {
            if (char.IsAsciiDigit(character)) digits[count++] = character;
            else if (character is not (' ' or '-' or '(' or ')' or '.')) return null;
        }
        var number = new string(digits, 0, count);

        if (international)
        {
            if (number.Length is < 8 or > 15 || number[0] == '0') return null;
            if (number[0] == '1' && number.Length != 11) return null;
            return "+" + number;
        }

        // Without a prefix only Dominican numbers are unambiguous.
        if (number.Length == 11 && number[0] == '1') number = number[1..];
        return number.Length == 10 && DominicanAreaCodes.Contains(number[..3]) ? "+1" + number : null;
    }

    public static bool IsValid(string? input) => Normalize(input) is not null;
}
