namespace Elevant.Domain.Entities.Workforce;

public sealed class RampAgentStationScope : Entity<long>
{
    public long RampAgentId { get; set; }

    public long StationId { get; set; }

    public DateOnly ValidFrom { get; set; }

    public DateOnly? ValidTo { get; set; }
}
