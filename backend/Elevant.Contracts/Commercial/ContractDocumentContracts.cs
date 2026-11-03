namespace Elevant.Contracts.Commercial;

public sealed record ContractDocumentRateResponse(string ServiceCode, string ServiceName, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);

/// <param name="HasDrawnSignature">The party drew its signature (ADR-0025); the image is printed in the PDF.</param>
public sealed record ContractDocumentSignatureResponse(string Party, string SignerName, string SignerTitle,
    DateTimeOffset SignedAt, string DocumentSha256, bool HasDrawnSignature);

/// <summary>Validity and renewal terms Contratos confirmed after Finance approval (ADR-0025).</summary>
public sealed record ContractValidityResponse(string RenewalMode, int? RenewalTermMonths, int RenewalNoticeDays,
    int TerminationNoticeDays, string? TerminationTerms, DateTimeOffset ConfirmedAt);

public sealed record ContractDocumentResponse(Guid ContractId, Guid VersionId, string ContractCode, string ContractStatus,
    string AirlineName, string AirlineCode, string? AirlineLegalName, int VersionNumber, string VersionStatus,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, IReadOnlyList<string> Stations,
    IReadOnlyList<ContractDocumentRateResponse> Rates, string? Terms, DateOnly? SignedOn,
    IReadOnlyList<ContractDocumentSignatureResponse> Signatures, string ContentSha256, string? SignableBy,
    ContractValidityResponse? Validity);

/// <param name="SignatureImagePng">Drawn signature: base64 PNG (or a canvas data URL), at most 256 KB and 1200×400 px.</param>
public sealed record SignContractRequest(string SignerName, string SignerTitle, string DocumentSha256, bool Accepted,
    string SignatureImagePng);

/// <summary>
/// Contratos confirms validity, renewal and termination before signatures (ADR-0025).
/// <c>RenewalMode</c> is Manual or Automatic; automatic renewal needs <c>RenewalTermMonths</c>.
/// </summary>
public sealed record SetContractValidityRequest(DateOnly ValidFrom, DateOnly ValidTo, string RenewalMode,
    int? RenewalTermMonths, int RenewalNoticeDays, int TerminationNoticeDays, string? TerminationTerms,
    string ExpectedDocumentSha256);
