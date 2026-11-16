namespace Elevant.Domain.Entities.Workforce;

public enum RampMobileAccessRequestStatus { Pending, Rejected, Fulfilled }

public sealed class RampMobileAccessRequest : AuditableEntity
{
    public long RampAgentId { get; set; }
    public long RequestedByAccountId { get; set; }
    public RampMobileAccessRequestStatus Status { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public long? DecidedByAccountId { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionReason { get; set; }
    public long? CreatedAccountId { get; set; }
}
