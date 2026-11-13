using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>Why a read of the OCC map was refused (ADR-0042, contracts 1.3).</summary>
public enum OccMapFailure
{
    /// <summary>No valid session behind the request.</summary>
    Unauthorized,

    /// <summary>Not AVIAM internal staff, or none of the map permissions.</summary>
    Forbidden,

    /// <summary>A malformed query: no station, a window or trail choice out of range, a hex that is not six hexadecimal digits.</summary>
    InvalidRequest,

    /// <summary>
    /// The station is not in the caller's scope or no longer active, the air picture is asked for a station that has none,
    /// or no read saw the aircraft lately.
    /// </summary>
    NotFound,
}

/// <summary>A read of the OCC map: its data, or why it was refused (<see cref="OccMapResult"/> builds one).</summary>
public sealed record OccMapResult<T>(T? Value, OccMapFailure? Failure)
    where T : class
{
    public bool IsSuccess => Value is not null && Failure is null;
}

/// <summary>Builds the results of the OCC map's reads.</summary>
public static class OccMapResult
{
    public static OccMapResult<T> Success<T>(T value)
        where T : class => new(value ?? throw new ArgumentNullException(nameof(value)), null);

    public static OccMapResult<T> Failed<T>(OccMapFailure failure)
        where T : class => new(null, failure);
}

/// <summary>
/// The air picture of a station as the map reads it (contracts 1.3): the picture from memory, the circle its reads cover
/// and, by address, the ELEVANT flight each live aircraft is (aircraft without a flight are not in
/// <paramref name="Matches"/>).
/// </summary>
public sealed record OccAirPictureData(Guid StationId, AirPictureSnapshot Picture, AirTrafficArea Center,
    IReadOnlyDictionary<string, FlightMatch> Matches);
