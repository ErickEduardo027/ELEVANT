using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Identity;

/// <summary>
/// One-time secret sent by email to a portal account: an activation or password-reset link, or a
/// 6-digit login code (ADR-0022). Only its SHA-256 is stored; it expires, is used once and a login
/// code locks after five wrong attempts.
/// </summary>
public sealed class AccountEmailToken : AuditableEntity
{
    public long AccountId { get; set; }

    public EmailPurpose Purpose { get; set; }

    /// <summary>Public handle of a login code; the code itself travels only by email.</summary>
    public Guid ChallengeId { get; set; }

    public string SecretHash { get; set; } = string.Empty;

    public DateTimeOffset ExpiresAt { get; set; }

    public int Attempts { get; set; }

    public DateTimeOffset? UsedAt { get; set; }
}
