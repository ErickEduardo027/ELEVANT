using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Workforce;

public sealed class AvailabilityRequest : AuditableEntity
{
    public long RampAgentId { get; set; }

    public DateOnly StartsOn { get; set; }

    public DateOnly EndsOn { get; set; }

    public AvailabilityRequestType Type { get; set; }

    public AvailabilityRequestStatus Status { get; set; }

    public string Reason { get; set; } = string.Empty;

    public DateTimeOffset RequestedAt { get; set; }

    public DateTimeOffset? ResolvedAt { get; set; }

    public long? ResolvedByAccountId { get; set; }

    public string? ResolutionNote { get; set; }
}
