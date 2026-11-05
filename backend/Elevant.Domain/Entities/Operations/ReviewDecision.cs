using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class ReviewDecision : AuditableEntity
{
    public long OperationSubmissionId { get; set; }

    public ReviewOutcome Outcome { get; set; }

    public long ReviewerAccountId { get; set; }

    public DateTimeOffset DecidedAt { get; set; }

    public string? Reason { get; set; }

    /// <summary>
    /// What OCC approved: the submitted evidence with the charges as they stood after the review
    /// adjustments (ADR-0034). Finance values this; the submitted snapshot stays untouched.
    /// </summary>
    public string? ApprovedEvidenceJson { get; set; }
}
