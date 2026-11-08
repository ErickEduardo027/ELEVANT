using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// One step of an incident's life (3-G), append-only: how it was reported, each change OCC made with its note, and
/// the resolution an approval writes. The incident row keeps only the current status and resolution.
/// </summary>
public sealed class IncidentStatusEvent : Entity<long>
{
    public long IncidentId { get; set; }

    /// <summary>Null for the event that records the report itself.</summary>
    public IncidentStatus? FromStatus { get; set; }

    public IncidentStatus ToStatus { get; set; }

    public string Note { get; set; } = string.Empty;

    public DateTimeOffset OccurredAt { get; set; }

    public long? ActorAccountId { get; set; }
}
