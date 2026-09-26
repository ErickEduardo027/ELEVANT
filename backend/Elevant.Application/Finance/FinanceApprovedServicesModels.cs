namespace Elevant.Application.Finance;

public enum FinanceApprovedServicesFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
}

public sealed record GetFinanceApprovedServicesQuery(
    Guid AccountId, Guid StationId, DateOnly From, DateOnly To);

public sealed record FinanceApprovedServiceData(
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

public sealed record FinanceApprovedServicesData(
    Guid StationId,
    DateOnly From,
    DateOnly To,
    IReadOnlyList<FinanceApprovedServiceData> Services,
    bool HasMore);

public sealed record FinanceApprovedServicesResult(
    FinanceApprovedServicesData? Data,
    FinanceApprovedServicesFailure? Failure)
{
    public bool IsSuccess => Data is not null && Failure is null;
    public static FinanceApprovedServicesResult Success(FinanceApprovedServicesData data) =>
        new(data, null);
    public static FinanceApprovedServicesResult Failed(FinanceApprovedServicesFailure failure) =>
        new(null, failure);
}
