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

/// <summary>Contratos withdraws an approved version both parties have not signed (2-N10).</summary>
/// <param name="ExpectedDocumentSha256">The content hash of the document on screen.</param>
public sealed record WithdrawContractVersionRequest(string Reason, string ExpectedDocumentSha256);

/// <summary>
/// The withdrawn version (Rejected) and its contract. <c>DraftVersionId</c> is the new draft with the same
/// content when the contract never activated and had nothing else alive.
/// </summary>
public sealed record ContractWithdrawalResponse(Guid VersionId, string VersionStatus, string ContractStatus,
    Guid? DraftVersionId);

/// <summary>A surcharge as it applies to the version; <c>Value</c> is a percentage for <c>PercentOfService</c>.</summary>
public sealed record ContractPricingChargeResponse(string ChargeCode, string ChargeName, string Method, string? BillingUnit,
    string QuantityRule, int GraceMinutes, decimal RoundingIncrement, bool IsExcluded, decimal? Value, decimal? MinimumAmount);

public sealed record ContractPricingPackageComponentResponse(string ServiceCode, string ServiceName, string BillingUnit,
    decimal IncludedQuantity, decimal ExcessBlockSize, decimal ExcessBlockPrice);

public sealed record ContractPricingPackageResponse(string Code, string Name, int VersionNumber, string Scope,
    string? FlightDirection, int? PeriodDays, decimal BasePrice, string CurrencyCode,
    IReadOnlyList<ContractPricingPackageComponentResponse> Components);

/// <summary>
/// Surcharges and packages of an approved or superseded version (2-N04). <c>InDocument</c>: they are part of
/// its signed content; <c>Signed</c>: and both parties signed it.
/// </summary>
public sealed record ContractPricingTermsResponse(Guid VersionId, string CurrencyCode, bool InDocument, bool Signed,
    IReadOnlyList<ContractPricingChargeResponse> Charges, IReadOnlyList<ContractPricingPackageResponse> Packages);
