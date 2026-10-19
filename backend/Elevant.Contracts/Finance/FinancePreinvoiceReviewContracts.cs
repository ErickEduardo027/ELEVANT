namespace Elevant.Contracts.Finance;

public sealed record FinancePreinvoiceReviewRequest(Guid RequestId, string ExpectedVersion, string Reason);
public sealed record FinanceCalculationStepResponse(string Label, decimal Value, string? Unit, string? Currency);
public sealed record FinanceLineCalculationResponse(Guid LineId, string Kind, string Description, Guid? OperationServiceId, Guid? SubmissionId, IReadOnlyList<FinanceCalculationStepResponse> Steps);
