using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class OperationChecklist : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public long ChecklistTemplateVersionId { get; set; }

    public ChecklistStatus Status { get; set; }

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? SubmittedAt { get; set; }

    public long? SubmittedByRampAgentId { get; set; }
}
