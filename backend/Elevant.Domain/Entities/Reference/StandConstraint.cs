using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Reference;

/// <summary>
/// A combined-stand rule the airport fixes (ADR-0030): while <see cref="StandId"/> is occupied,
/// <see cref="AffectedStandId"/> is cancelled or only takes narrow-body aircraft. OCC maintains them.
/// </summary>
public sealed class StandConstraint : AuditableEntity
{
    public long StationId { get; set; }

    public long StandId { get; set; }

    public long AffectedStandId { get; set; }

    public StandConstraintKind Kind { get; set; }

    public bool IsActive { get; set; }

    public long? CreatedByAccountId { get; set; }
}
