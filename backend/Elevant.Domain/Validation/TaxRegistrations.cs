namespace Elevant.Domain.Validation;

/// <summary>An airline's tax identifier with the country that issued it.</summary>
public sealed record TaxRegistration(string Number, string CountryCode);

/// <summary>
/// Tax identifier of an airline customer, printed on its contract and on its invoices. A Dominican
/// airline has an RNC (9 digits with its modulus-11 check digit, ADR-0020); any other country gives
/// its own identifier as written, trimmed, 3 to 32 characters.
/// </summary>
public static class TaxRegistrations
{
    public const string DominicanRepublic = "DO";
    public const int MinimumForeignLength = 3;
    public const int MaximumLength = 32;

    /// <summary>The canonical identifier (an RNC as its 9 digits), or null when it is not valid.</summary>
    public static TaxRegistration? Normalize(string? number, string? countryCode)
    {
        var country = countryCode?.Trim().ToUpperInvariant();
        if (!AirlineCodes.IsCountry(country) || string.IsNullOrWhiteSpace(number)) return null;
        if (country == DominicanRepublic)
            return IdentityDocuments.Normalize(IdentityDocumentKind.Rnc, number) is { } rnc
                ? new TaxRegistration(rnc, country) : null;
        var value = number.Trim();
        return value.Length is >= MinimumForeignLength and <= MaximumLength && !value.Any(char.IsControl)
            ? new TaxRegistration(value, country!) : null;
    }

    /// <summary>«RNC 1-31-23456-9» for a Dominican RNC; «Id. fiscal X (país)» otherwise.</summary>
    public static string Display(string number, string countryCode) =>
        countryCode == DominicanRepublic && number.Length == 9 && number.All(char.IsAsciiDigit)
            ? $"RNC {number[0]}-{number[1..3]}-{number[3..8]}-{number[8]}"
            : $"Id. fiscal {number} ({countryCode})";
}
