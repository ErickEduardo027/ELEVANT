namespace Elevant.Application.Abstractions.Finance;

public enum FinanceCatalogFailure { Forbidden, NotFound, Invalid, Conflict }

public sealed record FinanceCatalogResult(Guid? Id, FinanceCatalogFailure? Failure)
{
    public bool IsSuccess => Id is not null;
    public static FinanceCatalogResult Success(Guid id) => new(id, null);
    public static FinanceCatalogResult Failed(FinanceCatalogFailure failure) => new(null, failure);
}

public sealed record FinanceServiceOptionData(Guid Id, string Code, string Name, string DefaultBillingUnit, bool IsActive);
public sealed record BillingUnitData(Guid Id, string Code, string Name, int QuantityScale, bool IsActive, string Version);
public sealed record SaveBillingUnitInput(string Code, string Name, int QuantityScale, bool IsActive,
    string? ExpectedVersion = null);

public sealed record TariffVersionSummaryData(Guid Id, string CurrencyCode, DateOnly ValidFrom, DateOnly? ValidTo,
    string Status, string? Note, DateTimeOffset? PublishedAt, string? PublishedBy, int RateCount, string Version);

public sealed record ServiceTariffRateData(Guid ServiceId, string ServiceCode, string ServiceName, Guid? StationId,
    string? StationCode, string BillingUnit, decimal UnitPrice, decimal MinimumBillableQuantity);
public sealed record ServiceTariffVersionData(TariffVersionSummaryData Summary, IReadOnlyList<ServiceTariffRateData> Rates);
public sealed record ServiceTariffRateInput(Guid ServiceId, Guid? StationId, string BillingUnit, decimal UnitPrice,
    decimal MinimumBillableQuantity);

public sealed record CreateTariffDraftInput(string CurrencyCode, DateOnly ValidFrom, string? Note,
    Guid? CopyFromVersionId = null);
public sealed record SaveServiceTariffDraftInput(DateOnly ValidFrom, DateOnly? ValidTo, string? Note,
    IReadOnlyList<ServiceTariffRateInput> Rates, string ExpectedVersion);

public sealed record ChargeDefinitionData(Guid Id, string Code, string Name, string? Description, string Category,
    string Method, string QuantityRule, int GraceMinutes, decimal RoundingIncrement, bool AppliesToAllServices,
    IReadOnlyList<Guid> ServiceIds, bool AllowMultiple, bool VisibleToAgents, bool IsActive, string? BillingUnit,
    string Version);
public sealed record SaveChargeDefinitionInput(string Code, string Name, string? Description, string Category,
    string Method, string QuantityRule, int GraceMinutes, decimal RoundingIncrement, bool AppliesToAllServices,
    IReadOnlyList<Guid>? ServiceIds, bool AllowMultiple, bool VisibleToAgents, bool IsActive, string? BillingUnit,
    string? ExpectedVersion = null);

public sealed record ChargeRateData(Guid ChargeId, string ChargeCode, string ChargeName, string Method, decimal Value,
    decimal MinimumAmount);
public sealed record ChargeTariffVersionData(TariffVersionSummaryData Summary, IReadOnlyList<ChargeRateData> Rates);
public sealed record ChargeRateInput(Guid ChargeId, decimal Value, decimal MinimumAmount);
public sealed record SaveChargeTariffDraftInput(DateOnly ValidFrom, DateOnly? ValidTo, string? Note,
    IReadOnlyList<ChargeRateInput> Rates, string ExpectedVersion);

public sealed record ExchangeRateData(Guid Id, DateOnly RateDate, string FromCurrency, string ToCurrency, decimal Rate,
    string Source, string RecordedBy, DateTimeOffset RecordedAt, bool IsCurrent, Guid? SupersedesId, string Version);
public sealed record RecordExchangeRateInput(DateOnly RateDate, string FromCurrency, string ToCurrency, decimal Rate,
    string Source);
public sealed record CorrectExchangeRateInput(decimal Rate, string Source, string ExpectedVersion);

public sealed record ContractApprovalSummaryData(Guid VersionId, Guid ContractId, string ContractCode, string Airline,
    string CurrencyCode, DateOnly ValidFrom, DateOnly? ValidTo, string Status, DateTimeOffset SubmittedAt,
    int RatesBelowBase, int RatesWithoutBase, string Version);
public sealed record ContractRateComparisonData(Guid RateId, string ServiceCode, string ServiceName, string BillingUnit,
    decimal ContractPrice, decimal ContractMinimum, decimal? BasePrice, decimal? BaseMinimum, decimal? DifferencePercent);
public sealed record ContractChargeComparisonData(Guid ChargeId, string ChargeCode, string ChargeName, string Method,
    bool IsExcluded, decimal? ContractValue, decimal? BaseValue);
public sealed record ContractFinanceReviewData(string Decision, string? Reason, string DecidedBy, DateTimeOffset DecidedAt);
public sealed record ContractApprovalDetailData(ContractApprovalSummaryData Summary, string? Terms,
    IReadOnlyList<string> Stations, IReadOnlyList<ContractRateComparisonData> Rates,
    IReadOnlyList<ContractChargeComparisonData> Charges, IReadOnlyList<ContractFinanceReviewData> History);
public sealed record DecideContractApprovalInput(string Decision, string? Reason, string ExpectedVersion);

/// <summary>
/// Finance reference data: governed billing units, the base service tariff, the
/// charge catalog and its tariff, manually recorded exchange rates, and the
/// Finance approval that contract versions need before they become active.
/// Read methods return null when the actor may not read the data.
/// </summary>
public interface IFinanceTariffBookStore
{
    Task<IReadOnlyList<FinanceServiceOptionData>?> ListServicesAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<BillingUnitData>?> ListBillingUnitsAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> SaveBillingUnitAsync(Guid actorId, Guid? unitId, SaveBillingUnitInput input,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<TariffVersionSummaryData>?> ListServiceTariffsAsync(Guid actorId, string? currencyCode,
        CancellationToken cancellationToken = default);
    Task<ServiceTariffVersionData?> GetServiceTariffAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> CreateServiceTariffDraftAsync(Guid actorId, CreateTariffDraftInput input,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> SaveServiceTariffDraftAsync(Guid actorId, Guid versionId,
        SaveServiceTariffDraftInput input, CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> PublishServiceTariffAsync(Guid actorId, Guid versionId, string expectedVersion,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> DeleteServiceTariffDraftAsync(Guid actorId, Guid versionId, string expectedVersion,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ChargeDefinitionData>?> ListChargesAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> SaveChargeAsync(Guid actorId, Guid? chargeId, SaveChargeDefinitionInput input,
        CancellationToken cancellationToken = default);
    Task<IReadOnlyList<TariffVersionSummaryData>?> ListChargeTariffsAsync(Guid actorId, string? currencyCode,
        CancellationToken cancellationToken = default);
    Task<ChargeTariffVersionData?> GetChargeTariffAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> CreateChargeTariffDraftAsync(Guid actorId, CreateTariffDraftInput input,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> SaveChargeTariffDraftAsync(Guid actorId, Guid versionId,
        SaveChargeTariffDraftInput input, CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> PublishChargeTariffAsync(Guid actorId, Guid versionId, string expectedVersion,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> DeleteChargeTariffDraftAsync(Guid actorId, Guid versionId, string expectedVersion,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ExchangeRateData>?> ListExchangeRatesAsync(Guid actorId, DateOnly from, DateOnly to,
        bool includeHistory, CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> RecordExchangeRateAsync(Guid actorId, RecordExchangeRateInput input,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> CorrectExchangeRateAsync(Guid actorId, Guid rateId, CorrectExchangeRateInput input,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ContractApprovalSummaryData>?> ListContractApprovalsAsync(Guid actorId, bool pendingOnly,
        CancellationToken cancellationToken = default);
    Task<ContractApprovalDetailData?> GetContractApprovalAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default);
    Task<FinanceCatalogResult> DecideContractApprovalAsync(Guid actorId, Guid versionId,
        DecideContractApprovalInput input, CancellationToken cancellationToken = default);
}
