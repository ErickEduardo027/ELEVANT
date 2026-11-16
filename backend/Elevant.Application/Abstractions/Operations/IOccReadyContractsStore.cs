namespace Elevant.Application.Abstractions.Operations;

public sealed record OccReadyContractService(string Code, string Name, string BillingUnit);

/// <summary>
/// A contract OCC can plan flights for at a station on a date (ADR-0027): active, signed and with
/// the version Finance approved for that date. Prices are not shown to OCC.
/// </summary>
public sealed record OccReadyContractData(Guid ContractId, string ContractCode, Guid AirlineId, string AirlineName,
    string? AirlineIataCode, Guid VersionId, int VersionNumber, DateOnly ValidFrom, DateOnly? ValidTo,
    string? RenewalMode, IReadOnlyList<OccReadyContractService> Services, int FlightsOnDate);

public sealed record OccReadyContractsData(Guid StationId, string StationCode, DateOnly Date,
    IReadOnlyList<OccReadyContractData> Contracts);

public interface IOccReadyContractsStore
{
    /// <summary>Null when the actor lacks Planificación «Ver» or the station is out of its scope.</summary>
    Task<OccReadyContractsData?> ListAsync(Guid actorId, Guid stationId, DateOnly date,
        CancellationToken cancellationToken = default);
}
