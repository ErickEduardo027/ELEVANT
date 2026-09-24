using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class OperationChecklist : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public long ChecklistTemplateVersionId { get; set; }

    /// <summary>One immutable checklist per operation, template and handoff revision.</summary>
    public int RevisionNumber { get; set; } = 1;

    public ChecklistStatus Status { get; set; }

    public DateTimeOffset? StartedAt { get; set; }

    public DateTimeOffset? SubmittedAt { get; set; }

    public long? SubmittedByRampAgentId { get; set; }
}
