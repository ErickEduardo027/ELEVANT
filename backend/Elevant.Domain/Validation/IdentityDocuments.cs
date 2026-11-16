namespace Elevant.Domain.Validation;

/// <summary>Kinds of identity document the system validates by format.</summary>
public enum IdentityDocumentKind
{
    /// <summary>Dominican cédula: 3-digit office, 7-digit sequence and a Luhn check digit.</summary>
    Cedula,

    /// <summary>Residence card of a foreign resident: same number format as the cédula.</summary>
    Residence,

    /// <summary>Passport: Dominican ones are «RD» and seven digits; others follow their country or ICAO 9303.</summary>
    Passport,

    /// <summary>Dominican taxpayer number (RNC): 9 digits with a modulus-11 check digit.</summary>
    Rnc,
}

/// <summary>Outcome of checking a document: the canonical number, or why each position failed.</summary>
public sealed record IdentityDocumentCheck(string? Number, string? Problem)
{
    public bool IsValid => Number is not null;

    internal static IdentityDocumentCheck Valid(string number) => new(number, null);

    internal static IdentityDocumentCheck Invalid(string problem) => new(null, problem);
}

/// <summary>
/// Format rules for identity documents, shared by every form that records a person. Each rule
/// checks every character in its position so the error says which one is wrong (ADR-0020).
/// </summary>
public static class IdentityDocuments
{
    /// <summary>Prefix every Dominican passport number carries in positions 1–2 (AVIAM rule).</summary>
    public const string DominicanPassportPrefix = "RD";

    /// <summary>
    /// Position patterns of foreign passports, per ISO 3166-1 alpha-2 nationality. Each pattern
    /// is a string where <c>A</c> is a letter, <c>9</c> a digit and <c>X</c> either. Countries not
    /// listed follow ICAO 9303: 6 to 9 letters or digits with at least one digit.
    /// </summary>
    public static IReadOnlyDictionary<string, string[]> PassportPatterns { get; } = new Dictionary<string, string[]>
    {
        ["US"] = ["999999999", "A99999999"],
        ["CA"] = ["AA999999", "A999999AA"],
    };

    /// <summary>
    /// Returns the canonical number (upper-case letters and digits only) when it is valid for
    /// the kind, otherwise null. <paramref name="nationality"/> is the ISO 3166-1 alpha-2
    /// country of the person and only changes the passport rule.
    /// </summary>
    public static string? Normalize(IdentityDocumentKind kind, string? number, string? nationality = null) =>
        Check(kind, number, nationality).Number;

    /// <summary>Validates the document and explains, in Spanish, the first position that fails.</summary>
    public static IdentityDocumentCheck Check(IdentityDocumentKind kind, string? number, string? nationality = null)
    {
        var (value, problem) = Compact(number);
        if (value is null) return IdentityDocumentCheck.Invalid(problem!);
        return kind switch
        {
            IdentityDocumentKind.Cedula or IdentityDocumentKind.Residence => CheckCedula(value),
            IdentityDocumentKind.Passport when IsDominican(nationality) =>
                CheckPattern(value, [DominicanPassportPrefix + "9999999"], "El pasaporte dominicano"),
            IdentityDocumentKind.Passport when Country(nationality) is { } country &&
                PassportPatterns.TryGetValue(country, out var patterns) => CheckPattern(value, patterns, "El pasaporte"),
            IdentityDocumentKind.Passport => CheckIcaoPassport(value),
            IdentityDocumentKind.Rnc => CheckRnc(value),
            _ => IdentityDocumentCheck.Invalid("Tipo de documento no admitido."),
        };
    }

    /// <summary>Example shown next to the error so people know the expected shape.</summary>
    public static string Example(IdentityDocumentKind kind, string? nationality = null) => kind switch
    {
        IdentityDocumentKind.Cedula or IdentityDocumentKind.Residence => "001-1234567-8 (11 dígitos)",
        IdentityDocumentKind.Passport when IsDominican(nationality) => "RD1234567 (RD y 7 dígitos)",
        IdentityDocumentKind.Passport when Country(nationality) is { } country &&
            PassportPatterns.TryGetValue(country, out var patterns) => string.Join(" o ", patterns.Select(Describe)),
        IdentityDocumentKind.Passport => "6 a 9 letras y dígitos, p. ej. X1234567",
        IdentityDocumentKind.Rnc => "1-01-12345-6 (9 dígitos)",
        _ => string.Empty,
    };

    private static (string? Value, string? Problem) Compact(string? number)
    {
        if (string.IsNullOrWhiteSpace(number)) return (null, "Escribe el número del documento.");
        var trimmed = number.Trim();
        if (trimmed.Length > 40) return (null, "El número es demasiado largo.");
        var buffer = new char[trimmed.Length];
        var count = 0;
        foreach (var character in trimmed)
        {
            if (character is ' ' or '-' or '.') continue;
            if (!char.IsAsciiLetterOrDigit(character))
                return (null, $"El carácter «{character}» no es válido; usa solo letras y dígitos.");
            buffer[count++] = char.ToUpperInvariant(character);
        }
        return count == 0 ? (null, "Escribe el número del documento.") : (new string(buffer, 0, count), null);
    }

    private static string? Country(string? nationality) =>
        nationality?.Trim().ToUpperInvariant() is { Length: 2 } code ? code : null;

    private static bool IsDominican(string? nationality) => Country(nationality) == "DO";

    private static IdentityDocumentCheck CheckCedula(string value)
    {
        if (value.Length != 11)
            return IdentityDocumentCheck.Invalid($"La cédula tiene 11 dígitos (3 de oficina, 7 de secuencia y 1 verificador); escribiste {value.Length}.");
        for (var index = 0; index < 11; index++)
            if (!char.IsAsciiDigit(value[index]))
                return IdentityDocumentCheck.Invalid($"La posición {index + 1} de la cédula debe ser un dígito; encontramos «{value[index]}».");
        if (value.Distinct().Count() == 1)
            return IdentityDocumentCheck.Invalid("La cédula no puede repetir el mismo dígito en todas las posiciones.");
        var sum = 0;
        for (var index = 0; index < 10; index++)
        {
            var product = (value[index] - '0') * (index % 2 == 0 ? 1 : 2);
            sum += product > 9 ? product - 9 : product;
        }
        return (10 - sum % 10) % 10 == value[10] - '0'
            ? IdentityDocumentCheck.Valid(value)
            : IdentityDocumentCheck.Invalid("El dígito verificador (posición 11) no corresponde a los 10 anteriores; revisa el número.");
    }

    /// <summary>Checks the value against each pattern and reports the closest one's first wrong position.</summary>
    private static IdentityDocumentCheck CheckPattern(string value, IReadOnlyList<string> patterns, string subject)
    {
        string? best = null;
        var bestScore = -1;
        foreach (var pattern in patterns)
        {
            if (pattern.Length != value.Length)
            {
                if (bestScore < 0) best = $"{subject} tiene {DescribeLengths(patterns)} caracteres; escribiste {value.Length}.";
                continue;
            }
            var mismatch = Mismatch(value, pattern);
            if (mismatch is null) return IdentityDocumentCheck.Valid(value);
            if (mismatch.Value.Position > bestScore)
            {
                bestScore = mismatch.Value.Position;
                best = $"{subject}: la posición {mismatch.Value.Position + 1} debe ser {mismatch.Value.Expected}; encontramos «{value[mismatch.Value.Position]}». Formato: {Describe(pattern)}.";
            }
        }
        return IdentityDocumentCheck.Invalid(best!);
    }

    private static (int Position, string Expected)? Mismatch(string value, string pattern)
    {
        for (var index = 0; index < pattern.Length; index++)
        {
            var expected = pattern[index];
            var actual = value[index];
            var ok = expected switch
            {
                'A' => char.IsAsciiLetterUpper(actual),
                '9' => char.IsAsciiDigit(actual),
                'X' => char.IsAsciiLetterUpper(actual) || char.IsAsciiDigit(actual),
                _ => actual == expected,
            };
            if (!ok)
                return (index, expected switch
                {
                    'A' => "una letra",
                    '9' => "un dígito",
                    'X' => "una letra o un dígito",
                    _ => $"«{expected}»",
                });
        }
        return null;
    }

    // "RD9999999" reads as RD1234567; "AA999999" as LL000000 (L = letra, 0 = dígito).
    private static string Describe(string pattern) =>
        pattern.StartsWith(DominicanPassportPrefix, StringComparison.Ordinal) ? "RD1234567"
            : pattern.Replace('A', 'L').Replace('9', '0') + " (L = letra, 0 = dígito)";

    private static string DescribeLengths(IReadOnlyList<string> patterns)
    {
        var lengths = patterns.Select(pattern => pattern.Length).Distinct().Order().ToArray();
        return lengths.Length == 1 ? lengths[0].ToString(System.Globalization.CultureInfo.InvariantCulture)
            : string.Join(" u ", lengths.Select(length => length.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    }

    private static IdentityDocumentCheck CheckIcaoPassport(string value)
    {
        if (value.Length is < 6 or > 9)
            return IdentityDocumentCheck.Invalid($"El pasaporte tiene de 6 a 9 letras o dígitos (ICAO 9303); escribiste {value.Length}.");
        if (!value.Any(char.IsAsciiDigit))
            return IdentityDocumentCheck.Invalid("El pasaporte debe incluir al menos un dígito.");
        return value.Distinct().Count() > 2
            ? IdentityDocumentCheck.Valid(value)
            : IdentityDocumentCheck.Invalid("El número de pasaporte no puede repetir casi el mismo carácter.");
    }

    private static IdentityDocumentCheck CheckRnc(string value)
    {
        if (value.Length != 9)
            return IdentityDocumentCheck.Invalid($"El RNC tiene 9 dígitos; escribiste {value.Length}.");
        for (var index = 0; index < 9; index++)
            if (!char.IsAsciiDigit(value[index]))
                return IdentityDocumentCheck.Invalid($"La posición {index + 1} del RNC debe ser un dígito; encontramos «{value[index]}».");
        int[] weights = [7, 9, 8, 6, 5, 4, 3, 2];
        var sum = 0;
        for (var index = 0; index < 8; index++) sum += (value[index] - '0') * weights[index];
        var remainder = sum % 11;
        var check = remainder switch { 0 => 2, 1 => 1, _ => 11 - remainder };
        return check == value[8] - '0'
            ? IdentityDocumentCheck.Valid(value)
            : IdentityDocumentCheck.Invalid("El dígito verificador del RNC (posición 9) no corresponde; revisa el número.");
    }
}
