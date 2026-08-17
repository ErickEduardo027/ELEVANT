using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class ChecklistAnswer : AuditableEntity
{
    public long OperationChecklistId { get; set; }

    public long ChecklistTemplateItemId { get; set; }

    public ChecklistAnswerValue Value { get; set; }

    public string? Note { get; set; }

    public DateTimeOffset AnsweredAt { get; set; }

    public long RampAgentId { get; set; }
}
