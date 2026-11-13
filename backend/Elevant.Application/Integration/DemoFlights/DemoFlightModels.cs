namespace Elevant.Application.Integration.DemoFlights;

/// <summary>
/// The request to trigger a demo flight as it arrives, before <see cref="DemoFlightRules.Normalize"/> checks it: codes
/// in any case, the stand choice as text.
/// </summary>
public sealed record CreateDemoFlightCommand(Guid StationId, Guid AirlineId, string? OriginIata, string? DestinationIata,
    Guid AircraftTypeId, string? StandChoice, Guid? StandId, int MinutesToOnBlock, int GroundMinutes);

/// <summary>
/// A demo flight to trigger, already checked (ADR-0041): IATA codes in capitals, the destination resolved (the origin
/// when the request sent none), the minutes inside their ranges and the stand present only when it was chosen.
/// </summary>
public sealed record CreateDemoFlightInput(Guid StationId, Guid AirlineId, string OriginIata, string DestinationIata,
    Guid AircraftTypeId, DemoStandChoice StandChoice, Guid? StandId, int MinutesToOnBlock, int GroundMinutes);

/// <summary>
/// A demo flight as the superadministrator follows it (ADR-0041). <paramref name="Id"/> is the demo id both proposal
/// rows share. <paramref name="State"/> and <paramref name="Phase"/> are the names of <see cref="DemoFlightState"/>
/// and <see cref="DemoFlightPhase"/> at the server time of the answer, and every instant comes from
/// <see cref="DemoFlightTimeline"/>: no screen derives one. <paramref name="SuggestedStandCode"/> is the stand the
/// trigger proposed; <paramref name="StandCode"/> the one OCC assigned after importing the flight
/// (<paramref name="Imported"/>), with its turnaround, operation code and operation status.
/// </summary>
public sealed record DemoFlightData(Guid Id, Guid StationId, string StationCode, Guid AirlineId, string AirlineName,
    string ArrivalFlightNumber, string DepartureFlightNumber, string AircraftRegistration, string AircraftModel,
    string OriginIata, string DestinationIata, string? SuggestedStandCode, string State, string Phase,
    DateTimeOffset AppearAt, DateTimeOffset TouchdownAt, DateTimeOffset OnBlockAt, DateTimeOffset ScheduledOffBlockAt,
    DateTimeOffset? OffBlockAt, DateTimeOffset? TakeoffAt, DateTimeOffset? VanishAt, bool Imported, Guid? TurnaroundId,
    string? OperationCode, string? StandCode, string? OperationStatus);

/// <summary>
/// The demo flights of the last 24 hours at a station, newest first. With the feature off in this environment
/// <paramref name="Enabled"/> is false and the list is empty.
/// </summary>
public sealed record DemoFlightListData(bool Enabled, DateTimeOffset ServerTime, Guid? StationId,
    IReadOnlyList<DemoFlightData> Flights)
{
    /// <summary>The answer of an environment where demo flights are off.</summary>
    public static DemoFlightListData Disabled(DateTimeOffset serverTime) => new(false, serverTime, null, []);
}

/// <summary>
/// What the form «Disparar vuelo demo» offers at a station: the airlines with exactly one applicable contract on
/// <paramref name="OperationDate"/> (the station's local day), the airports of the catalogue except the station's own,
/// the active aircraft types and stands, the limits and the warnings that never block. With the feature off
/// <paramref name="Enabled"/> is false and every list is empty.
/// </summary>
public sealed record DemoFlightOptionsData(bool Enabled, DateTimeOffset ServerTime,
    IReadOnlyList<DemoStationOptionData> Stations, Guid? StationId, DateOnly? OperationDate,
    IReadOnlyList<DemoAirlineOptionData> Airlines, IReadOnlyList<DemoAirportOptionData> Airports,
    IReadOnlyList<DemoAircraftTypeOptionData> AircraftTypes, IReadOnlyList<DemoStandOptionData> Stands,
    DemoFlightLimitsData Limits, IReadOnlyList<DemoFlightWarningData> Warnings)
{
    /// <summary>The answer of an environment where demo flights are off: nothing to choose, the limits of the rules.</summary>
    public static DemoFlightOptionsData Disabled(DateTimeOffset serverTime) =>
        new(false, serverTime, [], null, null, [], [], [], [], DemoFlightLimitsData.For(0), []);
}

public sealed record DemoStationOptionData(Guid Id, string Code, string Name);

public sealed record DemoAirlineOptionData(Guid Id, string Name, string? IataCode, string IcaoCode);

public sealed record DemoAirportOptionData(string IataCode, string IcaoCode, string Name, string City, string CountryCode);

/// <summary><paramref name="SizeCategory"/> is Narrowbody, Widebody or null when unknown.</summary>
public sealed record DemoAircraftTypeOptionData(Guid Id, string IcaoCode, string Manufacturer, string Model,
    string? SizeCategory);

/// <summary>
/// An active stand of an active terminal. <paramref name="Free"/>: nothing occupies it during the visit and no other
/// active demo flight suggests it.
/// </summary>
public sealed record DemoStandOptionData(Guid StandId, string Code, string TerminalCode, bool Free);

/// <summary>
/// The ranges of the form (<see cref="DemoFlightRules"/>) and how many demo flights are active at the station out of
/// <paramref name="MaxActive"/>.
/// </summary>
public sealed record DemoFlightLimitsData(int MinMinutesToOnBlock, int MaxMinutesToOnBlock, int DefaultMinutesToOnBlock,
    int MinGroundMinutes, int MaxGroundMinutes, int DefaultGroundMinutes, int MaxActive, int Active)
{
    /// <summary>The limits of the rules with the station's count of active demo flights.</summary>
    public static DemoFlightLimitsData For(int active) =>
        new(DemoFlightRules.MinMinutesToOnBlock, DemoFlightRules.MaxMinutesToOnBlock, DemoFlightRules.DefaultMinutesToOnBlock,
            DemoFlightRules.MinGroundMinutes, DemoFlightRules.MaxGroundMinutes, DemoFlightRules.DefaultGroundMinutes,
            DemoFlightRules.MaxActivePerStation, active);
}

/// <summary>Something the superadministrator should know before triggering; it never blocks the command.</summary>
public sealed record DemoFlightWarningData(string Code, IReadOnlyList<string> Reasons);
