namespace Elevant.Contracts.Commercial;

/// <summary>
/// The fleet of an airline as AeroDataBox knows it (ADR-0028, note of 15 November 2026), for Contratos' intake and the
/// superadministrator's airline catalog: one read of the first page of the airline fleet (tier 3, 6 units), kept seven
/// days per airline code. It informs the reviewer that the airline flies real aircraft; it blocks nothing. It always comes
/// in a 200: <paramref name="Status"/> is <c>Available</c>, <c>NotFound</c> (no fleet registered: a warning),
/// <c>Disabled</c>, <c>DailyLimitReached</c>, <c>MonthlyLimitReached</c> or <c>Unavailable</c> (the last value kept may
/// come with the last three). <paramref name="AirlineCode"/> is the code asked, in upper case. <paramref name="TotalAircraft"/>
/// is the provider's count of active aircraft; <paramref name="Types"/> is the type mix of the sample it sent
/// (<paramref name="SampledAircraft"/> aircraft, at most 25), most frequent first.
/// </summary>
public sealed record AirlineFleetResponse(string AirlineCode, string Status, DateTimeOffset ServerTime,
    DateTimeOffset? RetrievedAt, string Source, int? TotalAircraft, int SampledAircraft,
    IReadOnlyList<AirlineFleetTypeResponse> Types);

/// <summary>An aircraft type of the sample: its ICAO type code when known, its model and how many aircraft have it.</summary>
public sealed record AirlineFleetTypeResponse(string? IcaoType, string Model, int Count);
