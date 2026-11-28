using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>How much of each aircraft's trail the air picture carries (contracts 1.3), as the query names it.</summary>
public static class OccAirPictureTrails
{
    /// <summary><c>short</c>: the last points of each trail, at most eight; what a screen asks for on its first read.</summary>
    public const string ShortTrails = "short";

    /// <summary><c>none</c>: no trail; what a screen asks for afterwards, adding the positions it receives to its own trails.</summary>
    public const string NoTrails = "none";
}

/// <summary>
/// <c>GET occ/map/air-picture</c> (ADR-0042, contracts 1.3): the live aircraft around the station with live traffic,
/// served from memory, each one with the ELEVANT flight it is. A read by someone who may see the map is demand: the network
/// is read for a while after it, and the first read after a quiet spell answers <c>Warming</c>. The picture's own state
/// (disabled, warming, stale, unavailable) travels in the success; the flights to match are read from the database only
/// when there are aircraft, at most three times a minute per station, and when that read fails the aircraft come without
/// a flight. M3: an aircraft a callsign lookup found takes the flight it was looked up for, by its callsign, when the
/// matcher gave it none and no other aircraft has that flight.
/// </summary>
public sealed class GetOccAirPictureHandler(IActorContextResolver actorResolver, AirPictureService picture,
    IOccMapFlightMatchKeyStore flights, AirTrafficSettings settings, TimeProvider timeProvider)
{
    private static readonly IReadOnlyDictionary<string, FlightMatch> NoMatches =
        new Dictionary<string, FlightMatch>(StringComparer.Ordinal);

    /// <param name="accountId">The account of the session.</param>
    /// <param name="stationId">The station whose picture is read.</param>
    /// <param name="trails"><c>short</c> (also when absent) or <c>none</c>, exactly; anything else is an invalid request.</param>
    /// <param name="cancellationToken">The request's cancellation.</param>
    public async Task<OccMapResult<OccAirPictureData>> HandleAsync(Guid accountId, Guid stationId, string? trails,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return OccMapResult.Failed<OccAirPictureData>(OccMapFailure.Unauthorized);
        if (stationId == Guid.Empty ||
            trails is not (null or OccAirPictureTrails.ShortTrails or OccAirPictureTrails.NoTrails))
            return OccMapResult.Failed<OccAirPictureData>(OccMapFailure.InvalidRequest);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (OccMapAccess.Check(actor, accountId, stationId, settings.StationCode) is { } failure)
            return OccMapResult.Failed<OccAirPictureData>(failure);

        picture.NoteDemand();
        var snapshot = picture.Read(shortTrails: trails is not OccAirPictureTrails.NoTrails);
        var matches = NoMatches;
        if (snapshot.Aircraft.Count > 0)
        {
            var now = timeProvider.GetUtcNow();
            var keys = await picture.MatchKeysAsync(stationId,
                token => flights.ListMatchKeysAsync(stationId, now, token), cancellationToken);
            matches = FlightAircraftMatcher.Match([.. snapshot.Aircraft.Select(item => item.Aircraft)], keys, now);
            if (snapshot.FoundFlightKeys.Count > 0) matches = WithFoundFlights(matches, snapshot.FoundFlightKeys, keys);
        }
        return OccMapResult.Success(new OccAirPictureData(stationId, snapshot, settings.Area, matches));
    }

    /// <summary>
    /// M3: the matches with the aircraft the lookups found: each takes its flight by its callsign when it has no match yet,
    /// the flight is still one of the station's (never a demo flight) and no other aircraft has it. One flight per aircraft
    /// and one aircraft per flight, as the matcher does.
    /// </summary>
    private static IReadOnlyDictionary<string, FlightMatch> WithFoundFlights(IReadOnlyDictionary<string, FlightMatch> matches,
        IReadOnlyDictionary<string, string> found, IReadOnlyList<MapFlightMatchKey> keys)
    {
        var flights = keys.Where(key => key is { IsDemo: false }).Select(key => key.FlightKey)
            .ToHashSet(StringComparer.Ordinal);
        var taken = matches.Values.Select(match => match.FlightKey).ToHashSet(StringComparer.Ordinal);
        var all = new Dictionary<string, FlightMatch>(matches, StringComparer.Ordinal);
        foreach (var (hex, flightKey) in found.OrderBy(entry => entry.Key, StringComparer.Ordinal))
        {
            if (all.ContainsKey(hex) || !flights.Contains(flightKey) || !taken.Add(flightKey)) continue;
            all[hex] = new FlightMatch(flightKey, FlightMatch.ByCallsign);
        }
        return all;
    }
}
