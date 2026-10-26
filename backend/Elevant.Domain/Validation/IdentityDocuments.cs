namespace Elevant.Domain.Validation;

/// <summary>Kinds of identity document the system validates by format.</summary>
public enum IdentityDocumentKind
{
    /// <summary>Dominican cédula: 11 digits whose last digit is a Luhn check digit.</summary>
    Cedula,

    /// <summary>Residence card of a foreign resident: same number format as the cédula.</summary>
    Residence,

    /// <summary>Passport: Dominican ones are two letters and seven digits; others follow ICAO 9303.</summary>
    Passport,

    /// <summary>Dominican taxpayer number (RNC): 9 digits with a modulus-11 check digit.</summary>
    Rnc,
}

/// <summary>Format rules for identity documents, shared by every form that records a person.</summary>
public static class IdentityDocuments
{
    /// <summary>
    /// Returns the canonical number (upper-case letters and digits only) when it is valid for
    /// the kind, otherwise null. <paramref name="nationality"/> is the ISO 3166-1 alpha-2
    /// country of the person and only changes the passport rule.
    /// </summary>
    public static string? Normalize(IdentityDocumentKind kind, string? number, string? nationality = null)
    {
        var value = Compact(number);
        if (value is null) return null;
        return kind switch
        {
            IdentityDocumentKind.Cedula or IdentityDocumentKind.Residence => IsCedula(value) ? value : null,
            IdentityDocumentKind.Passport => IsPassport(value, nationality) ? value : null,
            IdentityDocumentKind.Rnc => IsRnc(value) ? value : null,
            _ => null,
        };
    }

    /// <summary>Example shown next to the error so people know the expected shape.</summary>
    public static string Example(IdentityDocumentKind kind, string? nationality = null) => kind switch
    {
        IdentityDocumentKind.Cedula or IdentityDocumentKind.Residence => "001-1234567-8 (11 dígitos)",
        IdentityDocumentKind.Passport when IsDominican(nationality) => "RD1234567 (2 letras y 7 dígitos)",
        IdentityDocumentKind.Passport => "6 a 9 letras y dígitos, p. ej. X1234567",
        IdentityDocumentKind.Rnc => "1-01-12345-6 (9 dígitos)",
        _ => string.Empty,
    };

    private static string? Compact(string? number)
    {
        if (string.IsNullOrWhiteSpace(number)) return null;
        var trimmed = number.Trim();
        if (trimmed.Length > 40) return null;
        var buffer = new char[trimmed.Length];
        var count = 0;
        foreach (var character in trimmed)
        {
            if (character is ' ' or '-' or '.') continue;
            if (!char.IsAsciiLetterOrDigit(character)) return null;
            buffer[count++] = char.ToUpperInvariant(character);
        }
        return count == 0 ? null : new string(buffer, 0, count);
    }

    private static bool IsDominican(string? nationality) =>
        string.Equals(nationality?.Trim(), "DO", StringComparison.OrdinalIgnoreCase);

    private static bool IsCedula(string value)
    {
        if (value.Length != 11 || !value.All(char.IsAsciiDigit) || value.Distinct().Count() == 1) return false;
        var sum = 0;
        for (var index = 0; index < 10; index++)
        {
            var product = (value[index] - '0') * (index % 2 == 0 ? 1 : 2);
            sum += product > 9 ? product - 9 : product;
        }
        return (10 - sum % 10) % 10 == value[10] - '0';
    }

    private static bool IsPassport(string value, string? nationality)
    {
        if (IsDominican(nationality))
            return value.Length == 9 && value[..2].All(char.IsAsciiLetterUpper) && value[2..].All(char.IsAsciiDigit);
        return value.Length is >= 6 and <= 9 && value.Any(char.IsAsciiDigit) && value.Distinct().Count() > 2;
    }

    private static bool IsRnc(string value)
    {
        if (value.Length != 9 || !value.All(char.IsAsciiDigit)) return false;
        int[] weights = [7, 9, 8, 6, 5, 4, 3, 2];
        var sum = 0;
        for (var index = 0; index < 8; index++) sum += (value[index] - '0') * weights[index];
        var remainder = sum % 11;
        var check = remainder switch { 0 => 2, 1 => 1, _ => 11 - remainder };
        return check == value[8] - '0';
    }
}
