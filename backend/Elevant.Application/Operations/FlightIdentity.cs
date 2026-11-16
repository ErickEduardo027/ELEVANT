namespace Elevant.Application.Operations;

/// <summary>
/// How a flight is written once, whoever types it (manual entry, a reschedule, the flight feed): the number without
/// spaces in capitals and the IATA code of an airport in capitals. Duplicates are found with these forms.
/// </summary>
public static class FlightIdentity
{
    /// <summary>«ev 311» and «EV311» are the same flight.</summary>
    public static string NormalizeFlightNumber(string? value) =>
        value is null ? string.Empty : string.Concat(value.Where(c => !char.IsWhiteSpace(c))).ToUpperInvariant();

    public static bool IsFlightNumber(string value) =>
        value.Length is >= 2 and <= 16 && value.All(c => c is >= 'A' and <= 'Z' or >= '0' and <= '9');

    public static string NormalizeIata(string? value) => value?.Trim().ToUpperInvariant() ?? string.Empty;

    public static bool IsIata(string value) =>
        value.Length == 3 && value.All(c => c is >= 'A' and <= 'Z');
}
