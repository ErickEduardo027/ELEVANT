using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class ChecklistTemplateVersion : AuditableEntity
{
    public long ChecklistTemplateId { get; set; }

    public int VersionNumber { get; set; }

    public ChecklistVersionStatus Status { get; set; }

    public DateOnly EffectiveFrom { get; set; }

    public DateOnly? EffectiveTo { get; set; }

    public DateTimeOffset? PublishedAt { get; set; }

    public long? PublishedByAccountId { get; set; }
}
