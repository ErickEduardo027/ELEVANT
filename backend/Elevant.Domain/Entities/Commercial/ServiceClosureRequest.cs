namespace Elevant.Domain.Entities.Commercial;

public enum ServiceClosureStatus { Pending, Approved, Denied }

public sealed class ServiceClosureRequest : AuditableEntity
{
    public long ServiceDefinitionId { get; set; }
    public string ServiceNameSnapshot { get; set; } = string.Empty;
    public long RequestedByAccountId { get; set; }
    public string Reason { get; set; } = string.Empty;
    public ServiceClosureStatus Status { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public long? DecidedByAccountId { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public string? DecisionReason { get; set; }
    public long? ReopenedByAccountId { get; set; }
    public DateTimeOffset? ReopenedAt { get; set; }
    public string? ReopenReason { get; set; }
}
