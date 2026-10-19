namespace Elevant.Application.Abstractions.Finance;

public sealed record FinanceCalculationStep(string Label, decimal Value, string? Unit, string? Currency);
public sealed record FinanceLineCalculation(Guid LineId, string Kind, string Description, Guid? OperationServiceId, Guid? SubmissionId, IReadOnlyList<FinanceCalculationStep> Steps);
public sealed record PreinvoiceReviewInput(Guid RequestId, string ExpectedVersion, string Reason);
public interface IFinancePreinvoiceReviewStore
{
    Task<IReadOnlyList<FinanceLineCalculation>?> CalculationsAsync(Guid actorId, Guid preinvoiceId, CancellationToken cancellationToken = default);
    Task<PackageWriteResult> CancelAsync(Guid actorId, Guid preinvoiceId, PreinvoiceReviewInput input, CancellationToken cancellationToken = default);
    Task<PackageWriteResult> RestoreCalculationAsync(Guid actorId, Guid preinvoiceId, PreinvoiceReviewInput input, CancellationToken cancellationToken = default);
}
