namespace Elevant.Application.Abstractions.Commercial;

public sealed record ContractDraftRateData(Guid Id, string ServiceName,
    string BillingUnit, decimal UnitPrice, decimal MinimumQuantity);
public sealed record ContractDraftCommentData(Guid Id, string Author,
    string Body, DateTimeOffset At, bool IsAirline);
public sealed record ContractDraftData(Guid Id, Guid ContractId,
    string ContractCode, string Airline, string Status,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode,
    string? Terms, IReadOnlyList<string> Stations,
    IReadOnlyList<ContractDraftRateData> Rates,
    IReadOnlyList<ContractDraftCommentData> Comments);
public sealed record ContractDraftOverviewItemData(Guid Id, string ContractCode, string Airline);
public sealed record ContractDraftOverviewData(int Count,
    IReadOnlyList<ContractDraftOverviewItemData> Recent);
public sealed record UpdateDraftRateInput(Guid Id, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);
public sealed record UpdateContractDraftInput(DateOnly ValidFrom,
    DateOnly? ValidTo, string CurrencyCode, string Terms,
    IReadOnlyList<UpdateDraftRateInput> Rates);
public enum ContractDraftFailure { Forbidden, NotFound, Conflict, Invalid }
public sealed record ContractDraftResult(Guid? Id, ContractDraftFailure? Failure)
{
    public bool IsSuccess => Id is not null;
    public static ContractDraftResult Success(Guid id) => new(id, null);
    public static ContractDraftResult Failed(ContractDraftFailure failure) => new(null, failure);
}
public interface IContractDraftStore
{
    Task<ContractDraftOverviewData?> GetOverviewForContractsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ContractDraftData>?> ListForAirlineAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ContractDraftData>?> ListForContractsAsync(Guid actorId,
        CancellationToken cancellationToken = default);
    Task<ContractDraftResult> AddAirlineCommentAsync(Guid actorId, Guid versionId,
        string body, CancellationToken cancellationToken = default);
    Task<ContractDraftResult> UpdateAsync(Guid actorId, Guid versionId,
        UpdateContractDraftInput input, CancellationToken cancellationToken = default);
    Task<ContractDraftResult> ActivateAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default);
}
