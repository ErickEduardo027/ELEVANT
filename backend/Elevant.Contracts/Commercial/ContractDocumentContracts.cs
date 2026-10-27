namespace Elevant.Contracts.Commercial;

public sealed record ContractDocumentRateResponse(string ServiceCode, string ServiceName, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);

public sealed record ContractDocumentSignatureResponse(string Party, string SignerName, string SignerTitle,
    DateTimeOffset SignedAt, string DocumentSha256);

public sealed record ContractDocumentResponse(Guid ContractId, Guid VersionId, string ContractCode, string ContractStatus,
    string AirlineName, string AirlineCode, string? AirlineLegalName, int VersionNumber, string VersionStatus,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, IReadOnlyList<string> Stations,
    IReadOnlyList<ContractDocumentRateResponse> Rates, string? Terms, DateOnly? SignedOn,
    IReadOnlyList<ContractDocumentSignatureResponse> Signatures, string ContentSha256, string? SignableBy);

public sealed record SignContractRequest(string SignerName, string SignerTitle, string DocumentSha256, bool Accepted);
