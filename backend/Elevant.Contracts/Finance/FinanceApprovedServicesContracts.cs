namespace Elevant.Contracts.Finance;

public sealed record FinanceApprovedServiceResponse(
    Guid Id,
    Guid OperationId,
    Guid TurnaroundId,
    Guid ApprovedSubmissionId,
    string OperationCode,
    DateOnly OperationDate,
    Guid AirlineId,
    string AirlineName,
    string FlightNumber,
    string? ContractCode,
    string ServiceCode,
    string ServiceName,
    string ExecutionStatus,
    decimal ContractedQuantity,
    decimal ExecutedQuantity,
    string BillingUnit,
    decimal? FrozenUnitPrice,
    string? FrozenCurrency,
    bool Ready,
    string? BlockingReason,
    decimal? Amount,
    Guid? PreinvoiceId);

public sealed record FinanceApprovedServicesResponse(
    Guid StationId,
    DateOnly From,
    DateOnly To,
    IReadOnlyList<FinanceApprovedServiceResponse> Services,
    bool HasMore);
