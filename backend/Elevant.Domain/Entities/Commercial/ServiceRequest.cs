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

    public DateTimeOffset SubmittedAt { get; set; }

    public DateTimeOffset? ReviewedAt { get; set; }

    public long? ReviewedByAccountId { get; set; }

    public long? ProvisionedAccountId { get; set; }

    public string? DecisionReason { get; set; }

    public DateTimeOffset? CancelledAt { get; set; }
}
