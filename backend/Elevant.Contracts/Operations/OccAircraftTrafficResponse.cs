namespace Elevant.Contracts.Operations;

/// <summary>Provider observations for the fixed PUJ regional view.</summary>
public sealed record OccAircraftTrafficResponse(
    string Source,
    DateTimeOffset ProviderTime,
    DateTimeOffset RetrievedAt,
    bool Stale,
    IReadOnlyList<OccAircraftStateResponse> Aircraft);

public sealed record OccAircraftStateResponse(
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
