using Elevant.Application.Abstractions.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// What the matcher needs to know of one ELEVANT flight of the map (contracts 1.3): its key on the map, its direction
/// (<c>Arrival</c> or <c>Departure</c>), its number, its airline's designators, the registration it is planned with, its
/// best time (actual, else estimated, else scheduled), whether that time already happened and whether it is a demo flight.
/// </summary>
public sealed record MapFlightMatchKey(string FlightKey, string Direction, string FlightNumber, string AirlineIcaoCode,
    string? AirlineIataCode, string? Registration, DateTimeOffset BestTime, bool Happened, bool IsDemo);

/// <summary>The ELEVANT flight a live aircraft is, and how it was recognised.</summary>
public sealed record FlightMatch(string FlightKey, string MatchedBy)
{
    /// <summary>The registration the aircraft broadcasts is the one the flight is planned with.</summary>
    public const string ByRegistration = "Registration";

    /// <summary>The callsign the aircraft broadcasts is one of the flight's.</summary>
    public const string ByCallsign = "Callsign";
}

/// <summary>
/// Recognises the ELEVANT flights among the live aircraft of the picture (ADR-0042, contracts 1.3). Pure: it only reads
/// what it is given.
/// <list type="bullet">
/// <item>Candidates: arrivals whose best time is from two hours ago to six hours ahead, departures from one hour ago to
/// three hours ahead. A demo flight is never a candidate: its aircraft is not real.</item>
/// <item>An aircraft is matched by its registration when it and a candidate both know one; otherwise by its callsign,
/// against the flight's callsigns: the airline's ICAO designator with the number without and with its leading zeros, the
/// IATA designator with the number (with and without them) and the flight number itself.</item>
/// <item>Among several flights the aircraft takes the one whose ICAO callsign it broadcasts exactly, then any other
/// callsign of the flight; then a flight that has not happened yet, the earliest first; then the nearest in time.</item>
/// <item>One flight per aircraft and one aircraft per flight: when two aircraft take the same flight, a registration
/// beats a callsign and then the freshest position wins; the other aircraft stays without a flight.</item>
/// </list>
/// </summary>
public static class FlightAircraftMatcher
{
    /// <summary>An arrival stays a candidate until this long after its best time (it landed and is still taxiing).</summary>
    public static TimeSpan ArrivalsBack { get; } = TimeSpan.FromHours(2);

    /// <summary>An arrival is a candidate from this long before its best time (it is still on its way).</summary>
    public static TimeSpan ArrivalsAhead { get; } = TimeSpan.FromHours(6);

    /// <summary>A departure stays a candidate until this long after its best time (it is still climbing out).</summary>
    public static TimeSpan DeparturesBack { get; } = TimeSpan.FromHours(1);

    /// <summary>A departure is a candidate from this long before its best time (its aircraft waits on the ground).</summary>
    public static TimeSpan DeparturesAhead { get; } = TimeSpan.FromHours(3);

    /// <summary>
    /// The live aircraft that are ELEVANT flights, by their address (<see cref="AirTrafficAircraft.Hex"/>), with the key
    /// of their flight and how they were recognised. Aircraft without a flight are not in it.
    /// </summary>
    public static IReadOnlyDictionary<string, FlightMatch> Match(IReadOnlyList<AirTrafficAircraft> aircraft,
        IReadOnlyList<MapFlightMatchKey> flights, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(aircraft);
        ArgumentNullException.ThrowIfNull(flights);
        var candidates = flights
            .Where(flight => flight is { IsDemo: false } && !string.IsNullOrWhiteSpace(flight.FlightKey) && InWindow(flight, now))
            .DistinctBy(flight => flight.FlightKey, StringComparer.Ordinal)
            .Select(Candidate.Of)
            .ToArray();
        var matches = new Dictionary<string, FlightMatch>(StringComparer.Ordinal);
        if (candidates.Length == 0) return matches;

        // Each aircraft names its best flight; an address seen twice keeps its freshest position.
        var claims = new List<Claim>();
        foreach (var plane in aircraft.Where(item => item is not null && !string.IsNullOrWhiteSpace(item.Hex))
                     .GroupBy(item => item.Hex, StringComparer.Ordinal)
                     .Select(group => group.MaxBy(item => item.PositionAt)!))
        {
            if (BestFlight(plane, candidates, now) is { } claim) claims.Add(claim);
        }

        // One aircraft per flight: a registration beats a callsign, then the freshest position.
        foreach (var contest in claims.GroupBy(claim => claim.Flight.Key.FlightKey, StringComparer.Ordinal))
        {
            var winner = contest
                .OrderBy(claim => claim.MatchedBy == FlightMatch.ByRegistration ? 0 : 1)
                .ThenByDescending(claim => claim.Aircraft.PositionAt)
                .ThenBy(claim => claim.Aircraft.Hex, StringComparer.Ordinal)
                .First();
            matches[winner.Aircraft.Hex] = new FlightMatch(contest.Key, winner.MatchedBy);
        }
        return matches;
    }

    /// <summary>
    /// The callsign an airline's flight is flown with: its ICAO designator and the number without leading zeros
    /// (<c>ZZA</c> and <c>ZZ0123</c> give <c>ZZA123</c>; a letter after the number stays, <c>ZZA123A</c>). Null when
    /// <paramref name="icao"/> is not three letters or the flight number has no number of one to four digits. The map
    /// flights carry it as their <c>callsign</c>.
    /// </summary>
    public static string? IcaoCallsign(string icao, string flightNumber)
    {
        var designator = IcaoDesignator(icao);
        if (designator is null) return null;
        var number = NumberOf(FlightIdentity.NormalizeFlightNumber(flightNumber), designator, null);
        return number is null ? null : designator + WithoutLeadingZeros(number);
    }

    /// <summary>A callsign as the matcher compares it: upper case without spaces; null when blank.</summary>
    public static string? NormalizeCallsign(string? callsign)
    {
        if (callsign is null) return null;
        var normalized = string.Concat(callsign.Where(character => !char.IsWhiteSpace(character))).ToUpperInvariant();
        return normalized.Length == 0 ? null : normalized;
    }

    /// <summary>A registration as the matcher compares it: upper case without hyphens or spaces; null when blank.</summary>
    public static string? NormalizeRegistration(string? registration)
    {
        if (registration is null) return null;
        var normalized = string.Concat(registration.Where(character => character != '-' && !char.IsWhiteSpace(character)))
            .ToUpperInvariant();
        return normalized.Length == 0 ? null : normalized;
    }

    private static Claim? BestFlight(AirTrafficAircraft plane, IReadOnlyList<Candidate> candidates, DateTimeOffset now)
    {
        var registration = NormalizeRegistration(plane.Registration);
        var callsign = NormalizeCallsign(plane.Callsign);
        var pool = registration is null
            ? []
            : candidates.Where(candidate => candidate.Registration == registration).ToArray();
        var matchedBy = FlightMatch.ByRegistration;
        if (pool.Length == 0)
        {
            if (callsign is null) return null;
            pool = candidates.Where(candidate => candidate.Callsigns.Contains(callsign)).ToArray();
            matchedBy = FlightMatch.ByCallsign;
        }
        if (pool.Length == 0) return null;
        var best = pool
            .OrderBy(candidate => candidate.Strength(callsign))
            .ThenBy(candidate => candidate.Key.Happened)
            // Not happened yet: the earliest first. Happened: the nearest first.
            .ThenBy(candidate => candidate.Key.Happened
                ? Math.Abs((candidate.Key.BestTime - now).Ticks)
                : candidate.Key.BestTime.UtcTicks)
            .ThenBy(candidate => candidate.Key.FlightKey, StringComparer.Ordinal)
            .First();
        return new Claim(plane, best, matchedBy);
    }

    private static bool InWindow(MapFlightMatchKey flight, DateTimeOffset now)
    {
        if (string.Equals(flight.Direction, nameof(FlightDirection.Arrival), StringComparison.OrdinalIgnoreCase))
            return flight.BestTime >= now - ArrivalsBack && flight.BestTime <= now + ArrivalsAhead;
        if (string.Equals(flight.Direction, nameof(FlightDirection.Departure), StringComparison.OrdinalIgnoreCase))
            return flight.BestTime >= now - DeparturesBack && flight.BestTime <= now + DeparturesAhead;
        return false;
    }

    /// <summary>An airline's ICAO designator: three letters, upper case; null for anything else.</summary>
    private static string? IcaoDesignator(string? icao) =>
        icao?.Trim().ToUpperInvariant() is { Length: 3 } code && code.All(char.IsAsciiLetterUpper) ? code : null;

    /// <summary>An airline's IATA designator: two letters or digits, upper case; null for anything else.</summary>
    private static string? IataDesignator(string? iata) =>
        iata?.Trim().ToUpperInvariant() is { Length: 2 } code && code.All(char.IsAsciiLetterOrDigit) ? code : null;

    /// <summary>
    /// The number of a normalized flight number: one to four digits and an optional letter, after the airline's ICAO or
    /// IATA designator, else after any designator of two letters or digits and an optional letter; a flight number of
    /// digits only is its own number. Null when there is none.
    /// </summary>
    private static string? NumberOf(string flightNumber, string? icao, string? iata)
    {
        foreach (var designator in new[] { icao, iata })
        {
            if (designator is not null && flightNumber.StartsWith(designator, StringComparison.Ordinal) &&
                IsNumber(flightNumber.AsSpan(designator.Length)))
                return flightNumber[designator.Length..];
        }
        if (IsNumber(flightNumber)) return flightNumber;
        if (flightNumber.Length < 3 || !char.IsAsciiLetterOrDigit(flightNumber[0]) || !char.IsAsciiLetterOrDigit(flightNumber[1]))
            return null;
        if (IsNumber(flightNumber.AsSpan(2))) return flightNumber[2..];
        return char.IsAsciiLetterUpper(flightNumber[2]) && IsNumber(flightNumber.AsSpan(3)) ? flightNumber[3..] : null;
    }

    /// <summary>One to four digits and an optional upper-case letter.</summary>
    private static bool IsNumber(ReadOnlySpan<char> value)
    {
        var digits = 0;
        while (digits < value.Length && char.IsAsciiDigit(value[digits])) digits++;
        return digits is >= 1 and <= 4 &&
            (value.Length == digits || (value.Length == digits + 1 && char.IsAsciiLetterUpper(value[^1])));
    }

    private static string WithoutLeadingZeros(string number)
    {
        var start = 0;
        while (start < number.Length - 1 && number[start] == '0' && char.IsAsciiDigit(number[start + 1])) start++;
        return number[start..];
    }

    private sealed record Claim(AirTrafficAircraft Aircraft, Candidate Flight, string MatchedBy);

    private sealed class Candidate
    {
        private Candidate(MapFlightMatchKey key, string? registration, string? icaoCallsign, HashSet<string> callsigns)
        {
            Key = key;
            Registration = registration;
            IcaoCallsign = icaoCallsign;
            Callsigns = callsigns;
        }

        public MapFlightMatchKey Key { get; }

        public string? Registration { get; }

        /// <summary>The callsign the flight is flown with: the ICAO designator and the number without leading zeros.</summary>
        public string? IcaoCallsign { get; }

        /// <summary>Every callsign the flight may broadcast.</summary>
        public HashSet<string> Callsigns { get; }

        public static Candidate Of(MapFlightMatchKey key)
        {
            var flightNumber = FlightIdentity.NormalizeFlightNumber(key.FlightNumber);
            var icao = IcaoDesignator(key.AirlineIcaoCode);
            var iata = IataDesignator(key.AirlineIataCode);
            var callsigns = new HashSet<string>(StringComparer.Ordinal);
            string? icaoCallsign = null;
            if (NumberOf(flightNumber, icao, iata) is { } number)
            {
                var trimmed = WithoutLeadingZeros(number);
                if (icao is not null)
                {
                    icaoCallsign = icao + trimmed;
                    callsigns.Add(icaoCallsign);
                    callsigns.Add(icao + number);
                }
                if (iata is not null)
                {
                    callsigns.Add(iata + number);
                    callsigns.Add(iata + trimmed);
                }
            }
            if (flightNumber.Length > 0) callsigns.Add(flightNumber);
            return new Candidate(key, NormalizeRegistration(key.Registration), icaoCallsign, callsigns);
        }

        /// <summary>How well a callsign names this flight: 0 its ICAO callsign, 1 another of its callsigns, 2 none.</summary>
        public int Strength(string? callsign) =>
            callsign is null ? 2 : callsign == IcaoCallsign ? 0 : Callsigns.Contains(callsign) ? 1 : 2;
    }
}
