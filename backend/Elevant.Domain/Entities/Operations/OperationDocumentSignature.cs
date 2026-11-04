using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// A drawn signature on one form version, captured on the tablet. Append-only. The drawing is kept
/// as normalized strokes (vector), so the PDF draws it at any size without a raster image.
/// </summary>
public sealed class OperationDocumentSignature : AuditableEntity
{
    public long OperationDocumentVersionId { get; set; }

    public OperationSignatureRole Role { get; set; }

    /// <summary>Name the signer wrote (the airline representative is not an ELEVANT account).</summary>
    public string SignerName { get; set; } = string.Empty;

    /// <summary>The ramp agent's account that captured the signature on its device.</summary>
    public long CapturedByAccountId { get; set; }

    public long? MobileDeviceId { get; set; }

    public DateTimeOffset SignedAt { get; set; }

    /// <summary>SHA-256 of the content that was on screen when it was signed.</summary>
    public string DocumentSha256 { get; set; } = string.Empty;

    public string StrokesJson { get; set; } = string.Empty;

    public string StrokesSha256 { get; set; } = string.Empty;

    public Guid RequestId { get; set; }
}
