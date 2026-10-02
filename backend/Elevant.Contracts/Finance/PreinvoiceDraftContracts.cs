namespace Elevant.Contracts.Finance;

public sealed record CreatePreinvoiceDraftRequest(
    Guid StationId, DateOnly From, DateOnly To, Guid RequestId,
    IReadOnlyList<Guid> ServiceIds);

public sealed record CreatePreinvoiceDraftResponse(Guid Id, bool Replayed);

public sealed record PreinvoiceDraftLineResponse(
    Guid Id, Guid OperationServiceId, Guid ApprovedSubmissionId,
    int LineNumber, string OperationCode, DateOnly OperationDate,
    string ServiceCode, string ServiceName, decimal ExecutedQuantity,
    string BillingUnit, decimal UnitPrice, string CurrencyCode, decimal Amount);

public sealed record PreinvoiceDraftResponse(
    Guid Id, Guid AirlineId, string AirlineName, Guid StationId,
    DateOnly From, DateOnly To, string CurrencyCode,
    decimal Total, string Status, IReadOnlyList<PreinvoiceDraftLineResponse> Lines);
