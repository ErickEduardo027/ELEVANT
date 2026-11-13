using System.Globalization;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Integration.DemoFlights;

/// <summary>
/// The flight numbers, the registration and the provider references of a demo flight (ADR-0041). They are generated,
/// never typed: a number that met a flight OCC already planned that day would make the import link the demo pair to
/// it (3-N07), and a real registration could match a live aircraft.
/// </summary>
public static class DemoFlightNumbering
{
    /// <summary>The arrival takes the first free odd number from here, the departure the even number after it.</summary>
    public const int FirstArrivalNumber = 9001;

    public const int LastArrivalNumber = 9997;

    /// <summary>Demo registrations a station can use in one day: «HIDM01» to «HIDM99».</summary>
    public const int MaxSequenceOfDay = 99;

    /// <summary>
    /// The code an airline's flights are numbered with: its IATA designator, or the ICAO one when it has none.
    /// </summary>
    public static string AirlineCode(string? iataCode, string icaoCode) =>
        FlightIdentity.NormalizeFlightNumber(string.IsNullOrWhiteSpace(iataCode) ? icaoCode : iataCode);

    /// <summary>
    /// The first pair of numbers nobody uses: an odd arrival from 9001 and the even departure after it («ZZ9001» and
    /// «ZZ9002»). <paramref name="usedNormalizedNumbers"/> holds the flight numbers already known that day at the
    /// station (the proposals of any provider and the legs of turnarounds that are not cancelled), written as
    /// <see cref="FlightIdentity.NormalizeFlightNumber"/> writes them. Null when the day has no pair left.
    /// </summary>
    public static (string Arrival, string Departure)? NextPair(string airlineCode, IReadOnlySet<string> usedNormalizedNumbers)
    {
        ArgumentNullException.ThrowIfNull(usedNormalizedNumbers);
        var code = FlightIdentity.NormalizeFlightNumber(airlineCode);
        if (code.Length == 0) throw new ArgumentException("The airline code is required.", nameof(airlineCode));
        for (var number = FirstArrivalNumber; number <= LastArrivalNumber; number += 2)
        {
            var arrival = string.Create(CultureInfo.InvariantCulture, $"{code}{number}");
            var departure = string.Create(CultureInfo.InvariantCulture, $"{code}{number + 1}");
            if (!usedNormalizedNumbers.Contains(arrival) && !usedNormalizedNumbers.Contains(departure))
                return (arrival, departure);
        }
        return null;
    }

    /// <summary>
    /// The registration of the demo aircraft, from the count of demo flights of the day at the station: «HIDM01» to
    /// «HIDM99», the same for both legs so OCC's review pairs them. It is not a mark a registry issues (Dominican
    /// ones follow HI with digits), so it never matches live traffic. Null when the day has none left.
    /// </summary>
    public static string? Registration(int sequenceOfDay) =>
        sequenceOfDay is >= 1 and <= MaxSequenceOfDay
            ? string.Create(CultureInfo.InvariantCulture, $"HIDM{sequenceOfDay:00}")
            : null;

    /// <summary>The provider reference of one leg: the demo id both legs share and the direction.</summary>
    public static string Reference(Guid demoId, FlightDirection direction) => $"{demoId:N}|{direction}";

    /// <summary>The demo id of a reference <see cref="Reference"/> wrote; null for any other text.</summary>
    public static Guid? DemoIdOf(string? externalReference)
    {
        if (externalReference is null) return null;
        var separator = externalReference.IndexOf('|', StringComparison.Ordinal);
        if (separator < 0) return null;
        var direction = externalReference[(separator + 1)..];
        if (!Enum.GetNames<FlightDirection>().Contains(direction, StringComparer.Ordinal)) return null;
        return Guid.TryParseExact(externalReference.AsSpan(0, separator), "N", out var demoId) && demoId != Guid.Empty
            ? demoId
            : null;
    }
}
