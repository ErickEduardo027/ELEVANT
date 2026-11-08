using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// The exact content of one form at the moment someone signed it (ADR-0032). Immutable: when a
/// billable datum changes later the form gets a new content hash, and only that form asks for its
/// signatures again. The canonical JSON is what the SHA-256 covers and what the PDF is drawn from.
/// A Service Order OCC adjusted after it was signed (3-N02) is a version that corrects the one it
/// changed, with OCC's reason, author and time; the four correction fields are set together.
/// </summary>
public sealed class OperationDocumentVersion : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public OperationDocumentKind Kind { get; set; }

    /// <summary>Printed number, e.g. PUJ000000123 for the Service Order.</summary>
    public string DocumentNumber { get; set; } = string.Empty;

    public string ContentJson { get; set; } = string.Empty;

    public string ContentSha256 { get; set; } = string.Empty;

    /// <summary>The version this one corrects (3-N02); its chain ends at the version that was signed.</summary>
    public long? CorrectsVersionId { get; set; }

    public string? CorrectionReason { get; set; }

    public long? CorrectedByAccountId { get; set; }

    public DateTimeOffset? CorrectedAt { get; set; }
}
