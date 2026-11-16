namespace Elevant.Application.Abstractions.Operations;

/// <summary>
/// The airport of a station, for the reads that need its ICAO code: the OCC's weather (ADR-0043, contracts 1.4). Who may
/// read it is the caller's to decide: the store answers for the station it is asked about.
/// </summary>
public interface IOccStationAirportStore
{
    /// <summary>
    /// The ICAO code of the airport of the active station <paramref name="stationId"/>, trimmed and in upper case; null when
    /// the station is unknown or inactive.
    /// </summary>
    Task<string?> FindIcaoCodeAsync(Guid stationId, CancellationToken cancellationToken = default);
}
