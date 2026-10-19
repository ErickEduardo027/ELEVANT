namespace Elevant.Application.Abstractions.Finance;

public sealed record FinanceTaxPolicyInput(Guid RequestId, Guid AirlineId, Guid StationId, string CurrencyCode,
    string ConceptKind, string ConceptCode, string Treatment, decimal? Rate, string? Basis,
    DateOnly ValidFrom, DateOnly? ValidTo, Guid? ReplacesPolicyId, string? ExpectedVersion);
public sealed record FinanceTaxCommandInput(Guid RequestId, string ExpectedVersion);
public sealed record FinanceTaxOption(Guid Id, string Code, string Name);
public sealed record FinanceTaxContextData(IReadOnlyList<FinanceTaxOption> Airlines, IReadOnlyList<FinanceTaxOption> Stations);
public sealed record FinanceTaxPolicyData(Guid Id, Guid AirlineId, string AirlineName, Guid StationId, string StationCode,
    string CurrencyCode, string ConceptKind, string ConceptCode, string Treatment, decimal? Rate, string? Basis,
    DateOnly ValidFrom, DateOnly? ValidTo, string Status, Guid? ReplacesPolicyId, string Version);
public sealed record FinanceTaxLineData(Guid Id, int LineNumber, string ConceptKind, string ConceptCode, string Description,
    string Treatment, Guid? PolicyId, decimal? Rate, string? Basis, decimal Net, decimal Discount, decimal? Tax,
    decimal Gross, bool Configured, bool Excluded);
public sealed record FinanceTaxDetailData(Guid Id, string Version, string CurrencyCode, decimal Net, decimal Discount,
    decimal? Tax, decimal Gross, bool TreatmentsConfigured, IReadOnlyList<FinanceTaxLineData> Lines);
public sealed record FinanceTaxWriteResult(Guid? Id, string? Code)
{
    public bool IsSuccess => Id is not null;
    public static FinanceTaxWriteResult Success(Guid id) => new(id, null);
    public static FinanceTaxWriteResult Fail(string code) => new(null, code);
}
public interface IFinanceTaxStore
{
    Task<IReadOnlyList<FinanceTaxPolicyData>?> ListAsync(Guid actor, CancellationToken ct = default);
    Task<FinanceTaxContextData?> ContextAsync(Guid actor, CancellationToken ct = default);
    Task<FinanceTaxWriteResult> CreateAsync(Guid actor, FinanceTaxPolicyInput input, CancellationToken ct = default);
    Task<FinanceTaxWriteResult> PublishAsync(Guid actor, Guid id, FinanceTaxCommandInput input, CancellationToken ct = default);
    Task<FinanceTaxDetailData?> GetPreinvoiceAsync(Guid actor, Guid id, CancellationToken ct = default);
    Task<FinanceTaxWriteResult> ApplyAsync(Guid actor, Guid id, FinanceTaxCommandInput input, CancellationToken ct = default);
}
