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
}
