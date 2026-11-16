namespace Elevant.Application.Abstractions.Operations;

/// <summary>Why a master-data command failed; the result's code names the cause (2-A).</summary>
public enum MasterDataFailure { Forbidden, NotFound, Invalid, Conflict }

/// <summary>
/// Outcome of a master-data read or command: the value, or the failure with its stable code. A refused rule may
/// name what it breaks (<see cref="Reasons"/>, 3-A) and a taken unique value the record that holds it
/// (<see cref="ExistingId"/>, <c>airline_code_in_use</c>, 3-N21).
/// </summary>
public sealed record MasterDataResult<T>(T? Value, MasterDataFailure? Failure, string? Code, bool Replayed = false,
    IReadOnlyList<string>? Reasons = null, Guid? ExistingId = null)
    where T : class
{
    public static MasterDataResult<T> Success(T value, bool replayed = false) => new(value, null, null, replayed);

    public static MasterDataResult<T> Failed(MasterDataFailure failure, string code) => new(null, failure, code);

    public static MasterDataResult<T> Failed(MasterDataFailure failure, string code, IReadOnlyList<string>? reasons,
        Guid? existingId = null) => new(null, failure, code, false, reasons is { Count: > 0 } ? reasons : null, existingId);
}

/// <summary>The airport a station operates at (<c>ref.airports</c>).</summary>
public sealed record StationAirportData(Guid Id, string IataCode, string IcaoCode, string Name, string City,
    string CountryCode);

/// <summary>
/// A station as the superadministrator manages it (2-A). Its code never changes; its time zone only while it
/// has no history (<see cref="HasHistory"/>: flights, shifts, coverages, contracts or requests).
/// <see cref="Version"/> is the rowversion in base64, the expected version of the next command.
/// </summary>
public sealed record StationCatalogItemData(Guid Id, string Code, string Name, string IanaTimeZone, bool IsActive,
    bool HasHistory, StationAirportData Airport, string Version);

/// <summary>Every station, active or not, and the known airports that have no station yet.</summary>
public sealed record StationCatalogData(IReadOnlyList<StationCatalogItemData> Stations,
    IReadOnlyList<StationAirportData> AvailableAirports);

/// <summary>
/// A new station. <paramref name="Code"/> is the IATA code of its airport: a known airport is reused and the
/// airport fields are ignored; an unknown one needs its ICAO code, name, city and country.
/// </summary>
public sealed record CreateStationInput(string Code, string Name, string IanaTimeZone, string? AirportIcaoCode = null,
    string? AirportName = null, string? AirportCity = null, string? AirportCountryCode = null);

public sealed record UpdateStationInput(string Name, string IanaTimeZone, bool IsActive, string ExpectedVersion);

/// <summary>Stations of the platform, kept by the superadministrator (2-A). Nothing is deleted.</summary>
public interface IStationCatalogStore
{
    /// <summary>Null when the caller is not the superadministrator.</summary>
    Task<StationCatalogData?> ListAsync(Guid actorId, CancellationToken cancellationToken = default);

    Task<MasterDataResult<StationCatalogItemData>> CreateAsync(Guid actorId, CreateStationInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default);

    /// <summary>Renames, changes the time zone of a station without history, deactivates or reactivates it.</summary>
    Task<MasterDataResult<StationCatalogItemData>> UpdateAsync(Guid actorId, Guid stationId, UpdateStationInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);
}

/// <summary>
/// A terminal of the station. <see cref="HasHistory"/> (coverages or shifts there, or stands with history) fixes
/// its code; <see cref="Version"/> is the rowversion in base64.
/// </summary>
public sealed record MasterTerminalData(Guid Id, string Code, string Name, bool IsActive, bool HasHistory, string Version);

/// <summary>
/// A stand (position) of the station. <see cref="MaxAircraftSize"/> is Narrowbody, Widebody or null (any size);
/// <see cref="HasHistory"/> (flights or coverages that used it) fixes its code.
/// </summary>
public sealed record MasterStandData(Guid Id, Guid? TerminalId, string Code, bool HasBoardingBridge, bool IsRemote,
    string? MaxAircraftSize, bool IsActive, bool HasHistory, string Version);

/// <summary>An aircraft type of the shared catalog; its ICAO designator never changes.</summary>
public sealed record MasterAircraftTypeData(Guid Id, string IcaoCode, string? IataCode, string Manufacturer, string Model,
    string? SizeCategory, bool IsActive, string Version);

/// <summary>Terminals and stands of one station, active or not, and the aircraft types (2-A).</summary>
public sealed record OccMasterData(Guid StationId, string StationCode, IReadOnlyList<MasterTerminalData> Terminals,
    IReadOnlyList<MasterStandData> Stands, IReadOnlyList<MasterAircraftTypeData> AircraftTypes, bool CanCreate,
    bool CanUpdate);

public sealed record CreateTerminalInput(Guid StationId, string Code, string Name);

public sealed record UpdateTerminalInput(string Code, string Name, bool IsActive, string ExpectedVersion);

public sealed record CreateStandInput(Guid StationId, Guid TerminalId, string Code, bool HasBoardingBridge, bool IsRemote,
    string? MaxAircraftSize);

public sealed record UpdateStandInput(Guid TerminalId, string Code, bool HasBoardingBridge, bool IsRemote,
    string? MaxAircraftSize, bool IsActive, string ExpectedVersion);

public sealed record CreateAircraftTypeInput(string IcaoCode, string? IataCode, string Manufacturer, string Model,
    string? SizeCategory);

public sealed record UpdateAircraftTypeInput(string? IataCode, string Manufacturer, string Model, string? SizeCategory,
    bool IsActive, string ExpectedVersion);

/// <summary>
/// OCC master data (2-A) under <c>operations.master_data.*</c>: terminals and stands of a station in scope and
/// the shared aircraft types. Something in use is never deactivated (<c>terminal_in_use</c>, <c>stand_in_use</c>,
/// <c>aircraft_type_in_use</c>).
/// </summary>
public interface IOccMasterDataStore
{
    Task<MasterDataResult<OccMasterData>> ReadAsync(Guid actorId, Guid stationId, CancellationToken cancellationToken = default);

    Task<MasterDataResult<MasterTerminalData>> CreateTerminalAsync(Guid actorId, CreateTerminalInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default);

    Task<MasterDataResult<MasterTerminalData>> UpdateTerminalAsync(Guid actorId, Guid terminalId, UpdateTerminalInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<MasterDataResult<MasterStandData>> CreateStandAsync(Guid actorId, CreateStandInput input, Guid idempotencyKey,
        CancellationToken cancellationToken = default);

    Task<MasterDataResult<MasterStandData>> UpdateStandAsync(Guid actorId, Guid standId, UpdateStandInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<MasterDataResult<MasterAircraftTypeData>> CreateAircraftTypeAsync(Guid actorId, CreateAircraftTypeInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);

    Task<MasterDataResult<MasterAircraftTypeData>> UpdateAircraftTypeAsync(Guid actorId, Guid aircraftTypeId,
        UpdateAircraftTypeInput input, Guid idempotencyKey, CancellationToken cancellationToken = default);
}
