namespace Elevant.Application.Commercial;

public sealed record AirlineApprovedServiceData(
    Guid Id,
    string Code,
    string Name,
    string Status,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit);

public sealed record AirlineApprovedOperationEvidenceData(
    Guid OperationId,
    bool Available,
    DateTimeOffset? ApprovedAt,
    DateTimeOffset? ActualStartAt,
    DateTimeOffset? ActualEndAt,
    int IncidentCount,
    IReadOnlyList<AirlineApprovedServiceData> Services);

public sealed record AirlineApprovedOperationEvidenceResult(
    AirlineApprovedOperationEvidenceData? Evidence,
    AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Evidence is not null && Failure is null;

    public static AirlineApprovedOperationEvidenceResult Success(
        AirlineApprovedOperationEvidenceData evidence) => new(evidence, null);

    public static AirlineApprovedOperationEvidenceResult Failed(
        AirlinePortalFailure failure) => new(null, failure);
}
