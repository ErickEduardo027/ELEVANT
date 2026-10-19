namespace Elevant.Contracts.Finance;

public sealed record FinanceTaxPolicyRequest(Guid RequestId, Guid AirlineId, Guid StationId, string CurrencyCode,
    string ConceptKind, string ConceptCode, string Treatment, decimal? Rate, string? Basis,
    DateOnly ValidFrom, DateOnly? ValidTo, Guid? ReplacesPolicyId, string? ExpectedVersion);
public sealed record FinanceTaxCommandRequest(Guid RequestId, string ExpectedVersion);
public sealed record FinanceTaxIdResponse(Guid Id);
public sealed record FinanceTaxOptionResponse(Guid Id, string Code, string Name);
public sealed record FinanceTaxContextResponse(IReadOnlyList<FinanceTaxOptionResponse> Airlines, IReadOnlyList<FinanceTaxOptionResponse> Stations);
public sealed record FinanceTaxPolicyResponse(Guid Id, Guid AirlineId, string AirlineName, Guid StationId, string StationCode,
    string CurrencyCode, string ConceptKind, string ConceptCode, string Treatment, decimal? Rate, string? Basis,
    DateOnly ValidFrom, DateOnly? ValidTo, string Status, Guid? ReplacesPolicyId, string Version);
public sealed record FinanceTaxLineResponse(Guid Id, int LineNumber, string ConceptKind, string ConceptCode, string Description,
    string Treatment, Guid? PolicyId, decimal? Rate, string? Basis, decimal Net, decimal Discount, decimal? Tax,
    decimal Gross, bool Configured, bool Excluded);
public sealed record FinanceTaxDetailResponse(Guid Id, string Version, string CurrencyCode, decimal Net, decimal Discount,
    decimal? Tax, decimal Gross, bool TreatmentsConfigured, IReadOnlyList<FinanceTaxLineResponse> Lines);
