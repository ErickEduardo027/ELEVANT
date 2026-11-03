namespace Elevant.Contracts.Operations;

public sealed record OccReadyContractServiceResponse(string Code, string Name, string BillingUnit);

/// <summary>A contract OCC can plan flights for (ADR-0027). Prices are not shown to OCC.</summary>
public sealed record OccReadyContractResponse(Guid ContractId, string ContractCode, Guid AirlineId, string AirlineName,
    string? AirlineIataCode, Guid VersionId, int VersionNumber, DateOnly ValidFrom, DateOnly? ValidTo,
    string? RenewalMode, IReadOnlyList<OccReadyContractServiceResponse> Services, int FlightsOnDate);

public sealed record OccReadyContractsResponse(Guid StationId, string StationCode, DateOnly Date,
    IReadOnlyList<OccReadyContractResponse> Contracts);
