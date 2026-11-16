using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// <c>GET occ/map/aircraft/{hex}/track</c> (ADR-0042, contracts 1.3): the trail of one live aircraft from memory, its last
/// segment only and at most 600 points. The network is never asked for an aircraft's past: an address no read saw lately
/// is not found. Like the picture, a read by someone who may see the map is demand.
/// </summary>
public sealed class GetOccAircraftTrackHandler(IActorContextResolver actorResolver, AirPictureService picture,
    AirTrafficSettings settings)
{
    /// <param name="accountId">The account of the session.</param>
    /// <param name="stationId">The station whose picture the aircraft is in.</param>
    /// <param name="hex">The ICAO 24-bit address: six hexadecimal digits in any case; anything else is an invalid request.</param>
    /// <param name="cancellationToken">The request's cancellation.</param>
    public async Task<OccMapResult<AirTrackData>> HandleAsync(Guid accountId, Guid stationId, string? hex,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty) return OccMapResult.Failed<AirTrackData>(OccMapFailure.Unauthorized);
        if (stationId == Guid.Empty || NormalizeHex(hex) is not { } address)
            return OccMapResult.Failed<AirTrackData>(OccMapFailure.InvalidRequest);

        var actor = await actorResolver.ResolveAsync(accountId, cancellationToken);
        if (OccMapAccess.Check(actor, accountId, stationId, settings.StationCode) is { } failure)
            return OccMapResult.Failed<AirTrackData>(failure);

        picture.NoteDemand();
        return picture.Track(address) is { } track
            ? OccMapResult.Success(track)
            : OccMapResult.Failed<AirTrackData>(OccMapFailure.NotFound);
    }

    /// <summary>
    /// An ICAO 24-bit address as the picture keys it: six hexadecimal digits, in lower case. Null for anything else,
    /// surrounding spaces and the <c>~</c> of a non-ICAO address included.
    /// </summary>
    public static string? NormalizeHex(string? hex) =>
        hex is { Length: 6 } && hex.All(char.IsAsciiHexDigit) ? hex.ToLowerInvariant() : null;
}
