using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Audit;

public sealed class AuditEntry : Entity<long>
{
    public Guid PublicId { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public AuditActorType ActorType { get; set; }

    public long? ActorAccountId { get; set; }

    public string? ActorDisplay { get; set; }

    public string Action { get; set; } = string.Empty;

    public string EntityType { get; set; } = string.Empty;

    public Guid? EntityPublicId { get; set; }

    public long? OrganizationId { get; set; }

    public long? StationId { get; set; }

    public AuditSource Source { get; set; }

    public Guid CorrelationId { get; set; }

    public string? RequestId { get; set; }

    public string? Reason { get; set; }

    public string? MetadataJson { get; set; }
}
