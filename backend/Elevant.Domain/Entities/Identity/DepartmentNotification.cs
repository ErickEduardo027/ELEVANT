using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Identity;

/// <summary>
/// Durable alert for one internal account about something its department has to attend
/// (an access request, a commercial request, a contract waiting for Finance). The row only
/// points at the source; clients re-read the source under their current permissions.
/// </summary>
public sealed class DepartmentNotification : AuditableEntity
{
    public long RecipientAccountId { get; set; }

    public Department Department { get; set; }

    /// <summary>Station of the source when it is station-scoped; the reader must still hold that station.</summary>
    public long? StationId { get; set; }

    public string Kind { get; set; } = string.Empty;

    public Guid SourceId { get; set; }

    /// <summary>Short, non-sensitive subject such as an airline name or a requisition title.</summary>
    public string? Subject { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public DateTimeOffset? ReadAt { get; set; }
}
