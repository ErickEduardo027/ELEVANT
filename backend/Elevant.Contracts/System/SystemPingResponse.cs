namespace Elevant.Contracts.System;

/// <summary>Describes the running API without exposing configuration or host details.</summary>
public sealed record SystemPingResponse(
    string Application,
    string Status,
    string Environment,
    DateTimeOffset TimestampUtc);
