using System.ComponentModel.DataAnnotations;

namespace Elevant.Contracts.Finance;

/// <summary>Exactly one XML representation; decoded UTF-8 content is limited to 2 MiB.</summary>
public sealed record FinanceFiscalXmlValidationRequest(
    [Required, StringLength(3)] string DocumentType,
    string? XmlUtf8 = null,
    string? XmlBase64 = null);

public sealed record FinanceFiscalXmlValidationErrorResponse(string Code, string Message, int LineNumber, int LinePosition);

/// <summary>Offline preflight only. Signature presence is not cryptographic validity or fiscal acceptance.</summary>
public sealed record FinanceFiscalXmlValidationResponse(
    string SchemaId,
    string SchemaVersion,
    string SchemaSha256,
    string SchemaValidation,
    bool IsStructurallyValid,
    IReadOnlyList<FinanceFiscalXmlValidationErrorResponse> StructuralErrors,
    bool SignatureElementPresent,
    string CryptographicValidation,
    string FiscalAcceptance);
