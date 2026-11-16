namespace Elevant.Domain.Entities.Identity;

/// <summary>
/// One link of a rotating refresh-token chain (ADR-0021). Only the SHA-256 of the token is stored.
/// Each use replaces the token; presenting a replaced token again revokes the whole family.
/// </summary>
public sealed class RefreshToken : AuditableEntity
{
    public long AccountId { get; set; }

    /// <summary>Every token issued from one login shares the family.</summary>
    public Guid FamilyId { get; set; }

    public string TokenHash { get; set; } = string.Empty;

    /// <summary>SHA-256 of the account's security stamp when issued; a new stamp invalidates it.</summary>
    public string SecurityStampHash { get; set; } = string.Empty;

    public DateTimeOffset IssuedAt { get; set; }

    public DateTimeOffset LastUsedAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }

    public string? RevokedReason { get; set; }

    public long? ReplacedByTokenId { get; set; }
}
