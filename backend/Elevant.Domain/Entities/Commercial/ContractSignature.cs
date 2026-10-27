using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>
/// Acceptance of one approved contract version by one party. Append-only: a signature is never
/// edited or removed, and it records the SHA-256 of the exact content that was signed.
/// </summary>
public sealed class ContractSignature : AuditableEntity
{
    public long ContractVersionId { get; set; }

    public ContractSignatureParty Party { get; set; }

    public long SignerAccountId { get; set; }

    public string SignerName { get; set; } = string.Empty;

    public string SignerTitle { get; set; } = string.Empty;

    public DateTimeOffset SignedAt { get; set; }

    public string DocumentSha256 { get; set; } = string.Empty;

    public Guid RequestId { get; set; }
}
