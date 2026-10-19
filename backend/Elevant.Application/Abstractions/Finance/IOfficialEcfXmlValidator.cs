namespace Elevant.Application.Abstractions.Finance;

/// <summary>Offline, bounded preflight against pinned DGII schemas. Never signs, sends or accepts an e-CF.</summary>
public interface IOfficialEcfXmlValidator
{
    OfficialEcfXmlValidationResult Validate(OfficialEcfDocumentType documentType, ReadOnlyMemory<byte> xml);
}

public enum OfficialEcfDocumentType { E31 = 31, E32 = 32, E33 = 33, E34 = 34 }
public enum OfficialEcfSchemaValidation { NotPerformed, Passed, Failed }
public enum OfficialEcfCryptographicValidation { NotPerformed }

public sealed record OfficialEcfXmlValidationError(string Code, string Message, int LineNumber = 0, int LinePosition = 0);

/// <summary>
/// SchemaValidation describes the unmodified XSD only. StructuralErrors also
/// includes expected-type and signature-presence checks absent from the XSD.
/// A present Signature element is not proof of a valid signature or fiscal acceptance.
/// </summary>
public sealed record OfficialEcfXmlValidationResult(
    string SchemaId,
    string SchemaVersion,
    string SchemaSha256,
    OfficialEcfSchemaValidation SchemaValidation,
    IReadOnlyList<OfficialEcfXmlValidationError> StructuralErrors,
    bool SignatureElementPresent)
{
    public bool IsStructurallyValid => SchemaValidation == OfficialEcfSchemaValidation.Passed && StructuralErrors.Count == 0;
    public OfficialEcfCryptographicValidation CryptographicValidation => OfficialEcfCryptographicValidation.NotPerformed;
}
