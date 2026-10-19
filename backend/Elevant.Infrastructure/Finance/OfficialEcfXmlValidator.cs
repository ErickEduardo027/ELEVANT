using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Schema;
using Elevant.Application.Abstractions.Finance;

namespace Elevant.Infrastructure.Finance;

/// <summary>
/// Validates original XML bytes against one embedded, hash-pinned DGII XSD.
/// This preflight never verifies cryptography, taxpayer policy, totals arithmetic
/// or DGII acceptance. It is separate from the neutral Finance simulation.
/// </summary>
public sealed class OfficialEcfXmlValidator : IOfficialEcfXmlValidator
{
    private const int MaxDocumentBytes = 2 * 1024 * 1024;
    private const int MaxDepth = 64;
    private const int MaxErrors = 100;
    private const string SignatureNamespace = "http://www.w3.org/2000/09/xmldsig#";

    private static readonly SchemaDefinition E31 = new(OfficialEcfDocumentType.E31,
        "6f2909a93d84919518d2ae3c77fead4b35c3e8c95996b8af67b0040c2e2be298");
    private static readonly SchemaDefinition E32 = new(OfficialEcfDocumentType.E32,
        "151676df03c61335b4ac1eca97f99395488d57ea92793b49353602871e651f3c");
    private static readonly SchemaDefinition E33 = new(OfficialEcfDocumentType.E33,
        "087cd71beba11c19cf548e22b96363cb4aa210dc6f5c3c8a62122a42c88d2866");
    private static readonly SchemaDefinition E34 = new(OfficialEcfDocumentType.E34,
        "6c62ebabdea9a6f6d62ae85d9e1c2eb788f44f3f0b61945fe116700c4eaac2da");

    public OfficialEcfXmlValidationResult Validate(OfficialEcfDocumentType documentType, ReadOnlyMemory<byte> xml)
    {
        var definition = documentType switch
        {
            OfficialEcfDocumentType.E31 => E31,
            OfficialEcfDocumentType.E32 => E32,
            OfficialEcfDocumentType.E33 => E33,
            OfficialEcfDocumentType.E34 => E34,
            _ => throw new ArgumentOutOfRangeException(nameof(documentType), documentType, "Only E31–E34 v1.0 are supported."),
        };
        if (xml.Length > MaxDocumentBytes)
        {
            return Result(OfficialEcfSchemaValidation.NotPerformed,
                [new("DocumentTooLarge", "The XML exceeds the 2 MiB preflight limit.")], false);
        }

        var errors = new List<OfficialEcfXmlValidationError>();
        var schemaFailed = false;
        var signaturePresent = false;
        var parsed = false;
        var typeText = new StringBuilder();
        var elements = new List<string>();
        var settings = SafeReaderSettings();
        settings.ValidationType = ValidationType.Schema;
        settings.Schemas = definition.Schemas.Value;
        // Deliberately excludes ProcessSchemaLocation and ProcessInlineSchema.
        // Warnings fail closed too (e.g. a root for which no declaration exists).
        settings.ValidationFlags = XmlSchemaValidationFlags.ReportValidationWarnings;
        settings.ValidationEventHandler += (_, args) =>
        {
            schemaFailed = true;
            if (errors.Count >= MaxErrors - 1)
            {
                throw new ValidationLimitException("ErrorLimitExceeded", "The XML exceeded the diagnostic limit.");
            }
            AddError(new("XsdValidation", args.Message, args.Exception?.LineNumber ?? 0, args.Exception?.LinePosition ?? 0));
        };

        try
        {
            using var bytes = new MemoryStream(xml.ToArray(), writable: false);
            using var reader = XmlReader.Create(bytes, settings);
            while (reader.Read())
            {
                if (reader.Depth > MaxDepth)
                {
                    throw new ValidationLimitException("DepthLimitExceeded", "The XML exceeded the maximum depth of 64.");
                }
                if (reader.NodeType == XmlNodeType.Element)
                {
                    while (elements.Count > reader.Depth)
                    {
                        elements.RemoveAt(elements.Count - 1);
                    }
                    elements.Add(reader.NamespaceURI.Length == 0 ? reader.LocalName : reader.Name + "|" + reader.NamespaceURI);
                    if (reader.Depth == 1 && reader.LocalName == "Signature" && reader.NamespaceURI == SignatureNamespace)
                    {
                        signaturePresent = true; // Presence only; xs:any skips its content.
                    }
                }
                else if ((reader.NodeType is XmlNodeType.Text or XmlNodeType.CDATA or XmlNodeType.SignificantWhitespace) &&
                    reader.Depth == 4 && elements.Count == 4 &&
                    elements[0] == "ECF" && elements[1] == "Encabezado" &&
                    elements[2] == "IdDoc" && elements[3] == "TipoeCF")
                {
                    typeText.Append(reader.Value);
                }
            }
            parsed = true;
        }
        catch (XmlException exception)
        {
            schemaFailed = true;
            AddError(new("XmlRejected", exception.Message, exception.LineNumber, exception.LinePosition));
        }
        catch (ValidationLimitException exception)
        {
            schemaFailed = true;
            AddError(new(exception.Code, exception.Message));
        }

        if (parsed)
        {
            if (!int.TryParse(typeText.ToString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var actualType) ||
                actualType != (int)documentType)
            {
                AddError(new("DocumentTypeMismatch", "TipoeCF must match the explicitly selected schema."));
            }
            // Official format requires XMLDSig, whereas the XSD only requires xs:any.
            // Never turn an unsigned test marker into a successful preflight.
            if (!signaturePresent)
            {
                AddError(new("SignatureMissing", "The official format requires a direct XMLDSig Signature element; cryptographic validation was not performed."));
            }
        }

        return Result(schemaFailed ? OfficialEcfSchemaValidation.Failed : OfficialEcfSchemaValidation.Passed,
            errors.AsReadOnly(), signaturePresent);

        void AddError(OfficialEcfXmlValidationError error)
        {
            if (errors.Count >= MaxErrors)
            {
                return;
            }
            if (errors.Count == MaxErrors - 1)
            {
                errors.Add(new("ErrorLimitExceeded", "Additional XML diagnostics were suppressed."));
                return;
            }
            errors.Add(error.Message.Length <= 2048 ? error : error with { Message = error.Message[..2048] });
        }

        OfficialEcfXmlValidationResult Result(OfficialEcfSchemaValidation status,
            IReadOnlyList<OfficialEcfXmlValidationError> diagnostics, bool hasSignature) =>
            new($"DGII.ECF.{documentType}", "1.0", definition.Sha256, status, diagnostics, hasSignature);
    }

    private static XmlReaderSettings SafeReaderSettings() => new()
    {
        DtdProcessing = DtdProcessing.Prohibit,
        XmlResolver = null,
        MaxCharactersInDocument = MaxDocumentBytes,
        MaxCharactersFromEntities = 1024,
        ConformanceLevel = ConformanceLevel.Document,
    };

    private sealed class SchemaDefinition
    {
        public SchemaDefinition(OfficialEcfDocumentType type, string sha256)
        {
            Sha256 = sha256;
            Schemas = new Lazy<XmlSchemaSet>(() => Load(type), LazyThreadSafetyMode.ExecutionAndPublication);
        }

        public string Sha256 { get; }
        public Lazy<XmlSchemaSet> Schemas { get; }

        private XmlSchemaSet Load(OfficialEcfDocumentType type)
        {
            var resource = $"Elevant.Infrastructure.Finance.XmlSchemas.e-CF-{(int)type}-v1.0.xsd";
            using var stream = typeof(OfficialEcfXmlValidator).Assembly.GetManifestResourceStream(resource) ??
                throw new InvalidOperationException($"Required embedded DGII schema is missing: {resource}");
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            var bytes = copy.ToArray();
            if (!string.Equals(Convert.ToHexString(SHA256.HashData(bytes)), Sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"The embedded DGII schema hash does not match the reviewed source: {resource}");
            }
            using var input = new MemoryStream(bytes, writable: false);
            using var reader = XmlReader.Create(input, SafeReaderSettings());
            var schema = XmlSchema.Read(reader, null) ??
                throw new InvalidOperationException($"The embedded DGII schema cannot be read: {resource}");
            // All four reviewed official XSDs are self-contained. Never follow a
            // newly introduced include/import/redefine, even with a local-looking URL.
            if (schema.Includes.Count != 0)
            {
                throw new InvalidOperationException("DGII schema dependencies require an explicitly reviewed offline resource mapping.");
            }
            var set = new XmlSchemaSet { XmlResolver = null };
            set.Add(schema);
            set.Compile();
            return set;
        }
    }

    private sealed class ValidationLimitException(string code, string message) : Exception(message)
    {
        public string Code { get; } = code;
    }
}
