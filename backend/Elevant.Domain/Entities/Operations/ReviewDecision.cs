using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class ReviewDecision : AuditableEntity
{
    public long OperationSubmissionId { get; set; }

    public ReviewOutcome Outcome { get; set; }

    public long ReviewerAccountId { get; set; }

    public DateTimeOffset DecidedAt { get; set; }

    public string? Reason { get; set; }
}
