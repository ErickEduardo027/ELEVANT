namespace Elevant.Domain.Validation;

/// <summary>
/// Format rules for airline designators. IATA codes are two letters or a letter and a digit
/// (never two digits); ICAO codes are three letters. Placeholder designators used for unknown
/// or test carriers are rejected so they cannot pass as a real airline.
/// </summary>
public static class AirlineCodes
{
    private static readonly HashSet<string> ReservedIata = new(["YY", "ZZ", "XX", "QQ"], StringComparer.Ordinal);
    private static readonly HashSet<string> ReservedIcao = new(["YYY", "ZZZ", "XXX", "ZXX"], StringComparer.Ordinal);

    public static bool IsIata(string? code) =>
        code is { Length: 2 } && code.All(character => char.IsAsciiLetterUpper(character) || char.IsAsciiDigit(character)) &&
        !code.All(char.IsAsciiDigit) && !ReservedIata.Contains(code);

    public static bool IsIcao(string? code) =>
        code is { Length: 3 } && code.All(char.IsAsciiLetterUpper) && !ReservedIcao.Contains(code);

    public static bool IsCountry(string? code) => code is { Length: 2 } && code.All(char.IsAsciiLetterUpper);
}
