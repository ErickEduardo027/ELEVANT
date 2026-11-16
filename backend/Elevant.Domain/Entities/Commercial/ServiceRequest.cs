using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

public sealed class ServiceRequest : AuditableEntity
{
    public string RequestCode { get; set; } = string.Empty;

    public long? AirlineId { get; set; }

    public long? AirlineProfileId { get; set; }

    public string RequestedAirlineName { get; set; } = string.Empty;

    public string? AirlineLegalNameSnapshot { get; set; }

    public string? SubmissionHash { get; set; }

    public CommercialRequestType Type { get; set; }

    public CommercialRequestStatus Status { get; set; }

    public string ContactName { get; set; } = string.Empty;

    public string? ContactTitle { get; set; }

    public bool AuthorityDeclared { get; set; }

    public string ContactEmail { get; set; } = string.Empty;

    public string? ContactPhone { get; set; }

    public string? ContactNationalityCode { get; set; }

    public string? ContactAddress { get; set; }

    public string? ContactCountry { get; set; }

    public string? ContactProvince { get; set; }

    public string? ContactMunicipality { get; set; }

    /// <summary>Municipal district (D. M.) inside the municipality, when the country has them.</summary>
    public string? ContactDistrict { get; set; }

    public string? ContactDocumentType { get; set; }

    public string? ContactDocumentNumber { get; set; }

    public DateTimeOffset SubmittedAt { get; set; }

    public DateTimeOffset? ReviewedAt { get; set; }

    public long? ReviewedByAccountId { get; set; }

    public long? ProvisionedAccountId { get; set; }

    public string? DecisionReason { get; set; }

    public DateTimeOffset? CancelledAt { get; set; }

    /// <summary>
    /// When Contratos confirmed through the airline's own channels that the representative speaks
    /// for it; approval needs it (1-N18).
    /// </summary>
    public DateTimeOffset? RepresentativeConfirmedAt { get; set; }

    public long? RepresentativeConfirmedByAccountId { get; set; }

    /// <summary>How the representative was confirmed: who answered, through which channel.</summary>
    public string? RepresentativeConfirmationNote { get; set; }

    /// <summary>
    /// Airline the applicant proposed when it was not in the public catalog (1-N25); its name is
    /// <see cref="RequestedAirlineName"/>. Kept after Contratos links or creates the profile.
    /// </summary>
    public string? ProposedAirlineCountryCode { get; set; }

    public string? ProposedAirlineIataCode { get; set; }

    public string? ProposedAirlineIcaoCode { get; set; }

    public string? ProposedAirlineWebsiteUrl { get; set; }

    /// <summary>
    /// Tax identifier the applicant gave for the airline (an RNC when it is Dominican); Contratos may
    /// correct it while verifying, and the approval copies it to the airline's organization.
    /// </summary>
    public string? TaxRegistration { get; set; }

    public string? TaxRegistrationCountryCode { get; set; }

    /// <summary>
    /// Last automatic public-registry check of the request's airline (ADR-0023), run when a proposed
    /// airline is submitted and when Contratos approves: Found, Mismatch, Defunct, NotFound or Unavailable.
    /// </summary>
    public string? RegistryStatus { get; set; }

    public string? RegistrySource { get; set; }

    public DateTimeOffset? RegistryCheckedAt { get; set; }

    /// <summary>What the registry said, in Spanish (for example the differences of a mismatch).</summary>
    public string? RegistryDetail { get; set; }
}
