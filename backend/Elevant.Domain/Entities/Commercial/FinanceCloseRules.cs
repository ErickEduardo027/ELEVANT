using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Commercial;

/// <summary>
/// Ground time Finance allows for one aircraft category before the «package exceeded» surcharge
/// applies (ADR-0034). It is frozen in the evidence at hand-off, so a later change never revalues
/// operations already delivered.
/// </summary>
public sealed class GroundTimeAllowance : AuditableEntity
{
    public AircraftSizeCategory SizeCategory { get; set; }

    public int AllowedMinutes { get; set; }

    public long UpdatedByAccountId { get; set; }
}

/// <summary>A holiday of Finance's calendar: the Sunday-and-holiday surcharge applies on it (ADR-0034).</summary>
public sealed class FinanceHoliday : AuditableEntity
{
    public DateOnly Date { get; set; }

    public string Name { get; set; } = string.Empty;

    public long CreatedByAccountId { get; set; }

    public DateTimeOffset? RemovedAt { get; set; }

    public long? RemovedByAccountId { get; set; }
}
