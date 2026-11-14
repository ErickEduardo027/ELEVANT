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
/// a flight.
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
        }
        return OccMapResult.Success(new OccAirPictureData(stationId, snapshot, settings.Area, matches));
    }
}
