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

    /// <summary>
    /// The approved revision OCC reopened as this one (3-H); the three reopening fields are set together. A reopened
    /// revision keeps the hand-off it reopens (evidence, time and agent) and is decided again in OCC only.
    /// </summary>
    public long? ReopenedFromSubmissionId { get; set; }

    public long? ReopenedByAccountId { get; set; }

    public string? ReopenReason { get; set; }
}
