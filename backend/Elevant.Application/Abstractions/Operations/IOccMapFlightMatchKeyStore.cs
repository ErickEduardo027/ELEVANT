using Elevant.Application.Operations.AirPicture;

namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// The ELEVANT flights of a station the live aircraft are matched against (ADR-0042, contracts 1.3): the same flights the
/// map lists, with the keys it lists them by. <see cref="AirPictureService.MatchKeysAsync"/> keeps them twenty seconds
/// per station, so the picture asks for them at most three times a minute however many screens watch it.
/// </summary>
public interface IOccMapFlightMatchKeyStore
{
    /// <summary>
    /// The flights of the station around <paramref name="now"/> that an aircraft could be: at least every one the
    /// matcher's windows may take. A demo flight may be among them, marked <see cref="MapFlightMatchKey.IsDemo"/>:
    /// <see cref="FlightAircraftMatcher"/> never takes it. Empty for an unknown or inactive station.
    /// </summary>
    Task<IReadOnlyList<MapFlightMatchKey>> ListMatchKeysAsync(Guid stationId, DateTimeOffset now,
        CancellationToken cancellationToken = default);
}
