using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>Curated public airline identity; it is not a tenant or proof of a current contract.</summary>
public sealed class CommercialAirlineProfile : AuditableEntity
{
    public string SourceName { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? LegalName { get; set; }
    public string Region { get; set; } = string.Empty;
    public string? CountryCode { get; set; }
    public string? IataCode { get; set; }
    public string? IcaoCode { get; set; }
    public string? LogoObjectKey { get; set; }
    public string SourceUrl { get; set; } = string.Empty;
    public DateTimeOffset? VerifiedAt { get; set; }
    public long? VerifiedByAccountId { get; set; }
    public string? VerificationSourceUrl { get; set; }
    public bool IsPublished { get; set; }

    /// <summary>
    /// The airline's tax identifier as Superadministración recorded it (canonical, see TaxRegistrations: an RNC
    /// as its 9 digits); the public request prefills it. It is not part of the verified identity.
    /// </summary>
    public string? TaxRegistration { get; set; }
    /// <summary>ISO 3166-1 alpha-2 country that issued <see cref="TaxRegistration"/>.</summary>
    public string? TaxRegistrationCountryCode { get; set; }

    /// <summary>Last public-registry check (ADR-0023); cleared when the name or codes change.</summary>
    public AirlineRegistryStatus? RegistryStatus { get; set; }
    public string? RegistrySource { get; set; }
    public DateTimeOffset? RegistryCheckedAt { get; set; }
    public string? RegistryEntityUrl { get; set; }
    public long? CanonicalAirlineId { get; set; }
}
