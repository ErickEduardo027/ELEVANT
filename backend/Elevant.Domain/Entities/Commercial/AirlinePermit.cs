using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>
/// A permit or certificate the airline needs to be served (ADR-0024): operating permit, air
/// operator certificate, insurance… The airline submits it from the portal and Contratos verifies
/// it. Whether it is current, expiring or expired is computed from <see cref="ExpiresOn"/>.
/// </summary>
public sealed class AirlinePermit : AuditableEntity
{
    public long AirlineId { get; set; }

    public AirlinePermitKind Kind { get; set; }

    public string Number { get; set; } = string.Empty;

    public string Issuer { get; set; } = string.Empty;

    public DateOnly IssuedOn { get; set; }

    public DateOnly ExpiresOn { get; set; }

    /// <summary>Private media link (<c>/api/v1/media/{id}</c>) of the scanned document, if any.</summary>
    public string? DocumentUrl { get; set; }

    public AirlinePermitReview Review { get; set; }

    public long SubmittedByAccountId { get; set; }

    public DateTimeOffset? ReviewedAt { get; set; }

    public long? ReviewedByAccountId { get; set; }

    public string? ReviewNote { get; set; }

    /// <summary>When the 30-day expiry notice went out, so the daily sweep sends it once.</summary>
    public DateTimeOffset? ExpiryNoticeSentAt { get; set; }
}
