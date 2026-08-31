namespace Elevant.Domain.Entities.Workforce;

public sealed class RampAgentTerminalScope : Entity<long>
{
    public long RampAgentId { get; set; }

    public long TerminalId { get; set; }

    public DateOnly ValidFrom { get; set; }

    public DateOnly? ValidTo { get; set; }
}
