namespace Elevant.Application.Operations;

public sealed record OccAircraftTrafficData(
    DateTimeOffset ProviderTime,
    DateTimeOffset RetrievedAt,
    bool Stale,
    IReadOnlyList<OccAircraftStateData> Aircraft);

public sealed record OccAircraftStateData(
    string Icao24,
    string? Callsign,
    string? OriginCountry,
    double Latitude,
    double Longitude,
    DateTimeOffset? LastPositionAt,
    DateTimeOffset? LastContactAt,
    double? BarometricAltitudeMeters,
    double? GeometricAltitudeMeters,
    double? GroundSpeedMetersPerSecond,
    double? TrueTrackDegrees,
    double? VerticalRateMetersPerSecond,
    bool OnGround,
    string? Squawk,
    int? PositionSource,
    int? Category);

public enum OccAircraftTrafficFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Unavailable,
}

public sealed record OccAircraftTrafficResult(
    OccAircraftTrafficData? Traffic,
    OccAircraftTrafficFailure? Failure)
{
    public bool IsSuccess => Traffic is not null && Failure is null;

    public static OccAircraftTrafficResult Success(OccAircraftTrafficData traffic) => new(traffic, null);
    public static OccAircraftTrafficResult Failed(OccAircraftTrafficFailure failure) => new(null, failure);
}
