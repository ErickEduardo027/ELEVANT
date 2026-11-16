namespace Elevant.Contracts.Commercial;

/// <summary>Sanitized, approved execution snapshot for one authorized airline operation.</summary>
public sealed record AirlineApprovedOperationEvidenceResponse(
    Guid OperationId,
    bool Available,
    DateTimeOffset? ApprovedAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? ActualEndAt,
    int IncidentCount,
    IReadOnlyList<AirlineApprovedServiceResponse> Services);

public sealed record AirlineApprovedServiceResponse(
    Guid Id,
    string Code,
    string Name,
    string Status,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit);
