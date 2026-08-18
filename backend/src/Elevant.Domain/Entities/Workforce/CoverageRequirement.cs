using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Workforce;

public sealed class CoverageRequirement : AuditableEntity
{
    public long StationId { get; set; }

    public long TerminalId { get; set; }

    public long OperationalPositionId { get; set; }

    public ShiftBlock Block { get; set; }

    public DateOnly EffectiveFrom { get; set; }

    public DateOnly? EffectiveTo { get; set; }

    public int RequiredAgentCount { get; set; }
}
