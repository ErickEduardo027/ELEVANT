namespace Elevant.Domain.Entities.Commercial;

/// <summary>Metadata for an immutable object held in private S3-compatible storage.</summary>
public sealed class MediaAsset
{
    public long Id { get; set; }
    public Guid PublicId { get; set; }
    public string ObjectKey { get; set; } = string.Empty;
    public string Purpose { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long Length { get; set; }
    public string Sha256 { get; set; } = string.Empty;
    public long UploadedByAccountId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
