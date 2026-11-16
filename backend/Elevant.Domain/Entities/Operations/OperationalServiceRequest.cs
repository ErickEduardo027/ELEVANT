using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class OperationalServiceRequest : AuditableEntity
{
    public long AirlineId { get; set; }

    public long StationId { get; set; }

    public long? TurnaroundId { get; set; }

    public long? ServiceDefinitionId { get; set; }

    public long RequestedByAccountId { get; set; }

    public OperationalRequestStatus Status { get; set; }

    public string RequestedServiceName { get; set; } = string.Empty;

    public string Description { get; set; } = string.Empty;

    public DateTimeOffset RequestedAt { get; set; }

    public DateTimeOffset? NeededAt { get; set; }

    public DateTimeOffset? ResolvedAt { get; set; }

    public long? ResolvedByAccountId { get; set; }

    public string? ResolutionNote { get; set; }
}
