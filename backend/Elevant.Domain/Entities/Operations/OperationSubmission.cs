using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

public sealed class OperationSubmission : AuditableEntity
{
    public long GroundOperationId { get; set; }

    public long OperationChecklistId { get; set; }

    public int RevisionNumber { get; set; }

    public SubmissionStatus Status { get; set; }

    public long SubmittedByRampAgentId { get; set; }

    public DateTimeOffset SubmittedAt { get; set; }

    public string? AgentNote { get; set; }

    /// <summary>Immutable service and incident evidence captured at handoff.</summary>
    public string? EvidenceJson { get; set; }
}
