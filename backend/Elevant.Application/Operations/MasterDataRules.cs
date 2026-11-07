using System.Text.RegularExpressions;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// Normalization and validation of the master data OCC and the superadministrator type (2-A). Every method
/// returns the normalized value, or null when the value is not acceptable; the stores answer the matching code.
/// </summary>
public static partial class MasterDataRules
{
    /// <summary>Station code: the 3-letter IATA code of its airport («PUJ»).</summary>
    public static string? StationCode(string? value) => Match(value?.Trim().ToUpperInvariant(), ThreeLetters());

    /// <summary>ICAO code of an airport: 4 letters («MDPC»).</summary>
    public static string? AirportIcao(string? value) => Match(value?.Trim().ToUpperInvariant(), FourLetters());

    /// <summary>ISO 3166 country of an airport: 2 letters («DO»).</summary>
    public static string? CountryCode(string? value) => Match(value?.Trim().ToUpperInvariant(), TwoLetters());

    /// <summary>A name of 2 to <paramref name="maxLength"/> characters, trimmed, without control characters.</summary>
    public static string? Name(string? value, int maxLength)
    {
        var text = value?.Trim();
        return text is null || text.Length < 2 || text.Length > maxLength || text.Any(char.IsControl) ? null : text;
    }

    /// <summary>Terminal code: 1 to 16 letters, digits or hyphens («A», «FBO»).</summary>
    public static string? TerminalCode(string? value) => Match(value?.Trim().ToUpperInvariant(), TerminalPattern());

    /// <summary>Stand code: 1 to 24 letters, digits or hyphens («A01», «9A»).</summary>
    public static string? StandCode(string? value) => Match(value?.Trim().ToUpperInvariant(), StandPattern());

    /// <summary>ICAO aircraft type designator: 4 characters, a letter first («A320», «B738»).</summary>
    public static string? AircraftIcao(string? value) => Match(value?.Trim().ToUpperInvariant(), AircraftIcaoPattern());

    /// <summary>IATA aircraft type code: 3 letters or digits («320», «73H»); empty means none.</summary>
    public static bool TryAircraftIata(string? value, out string? iata)
    {
        iata = string.IsNullOrWhiteSpace(value) ? null : value.Trim().ToUpperInvariant();
        return iata is null || AircraftIataPattern().IsMatch(iata);
    }

    /// <summary>Narrowbody, Widebody or null (any size or unknown); numbers are never accepted as names.</summary>
    public static bool TryParseSize(string? value, out AircraftSizeCategory? size)
    {
        size = null;
        if (value is null) return true;
        if (!Enum.GetNames<AircraftSizeCategory>().Contains(value, StringComparer.Ordinal)) return false;
        size = Enum.Parse<AircraftSizeCategory>(value);
        return true;
    }

    /// <summary>An IANA time zone this host knows («America/Santo_Domingo»); Windows identifiers are refused.</summary>
    public static string? IanaTimeZone(string? value)
    {
        var zone = value?.Trim();
        if (zone is null || zone.Length > 64 || (zone != "UTC" && !IanaPattern().IsMatch(zone))) return null;
        if (TimeZoneInfo.TryConvertIanaIdToWindowsId(zone, out _)) return zone;
        return TimeZoneInfo.TryFindSystemTimeZoneById(zone, out var found) && found.HasIanaId ? zone : null;
    }

    private static string? Match(string? value, Regex pattern) => value is not null && pattern.IsMatch(value) ? value : null;

    [GeneratedRegex("^[A-Z]{3}$")]
    private static partial Regex ThreeLetters();

    [GeneratedRegex("^[A-Z]{4}$")]
    private static partial Regex FourLetters();

    [GeneratedRegex("^[A-Z]{2}$")]
    private static partial Regex TwoLetters();

    [GeneratedRegex("^[A-Z0-9](?:[A-Z0-9-]{0,14}[A-Z0-9])?$")]
    private static partial Regex TerminalPattern();

    [GeneratedRegex("^[A-Z0-9](?:[A-Z0-9-]{0,22}[A-Z0-9])?$")]
    private static partial Regex StandPattern();

    [GeneratedRegex("^[A-Z][A-Z0-9]{3}$")]
    private static partial Regex AircraftIcaoPattern();

    [GeneratedRegex("^[A-Z0-9]{3}$")]
    private static partial Regex AircraftIataPattern();

    [GeneratedRegex("^[A-Za-z]+(?:/[A-Za-z0-9_+-]+){1,2}$")]
    private static partial Regex IanaPattern();
}
