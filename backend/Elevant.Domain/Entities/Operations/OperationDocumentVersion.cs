using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// The exact content of one form at the moment someone signed it (ADR-0032). Immutable: when a
/// billable datum changes later the form gets a new content hash, and only that form asks for its
/// signatures again. The canonical JSON is what the SHA-256 covers and what the PDF is drawn from.
/// </summary>
public sealed class OperationDocumentVersion : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public OperationDocumentKind Kind { get; set; }

    /// <summary>Printed number, e.g. PUJ000000123 for the Service Order.</summary>
    public string DocumentNumber { get; set; } = string.Empty;

    public string ContentJson { get; set; } = string.Empty;

    public string ContentSha256 { get; set; } = string.Empty;
}
