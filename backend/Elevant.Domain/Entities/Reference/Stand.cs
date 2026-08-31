namespace Elevant.Domain.Entities.Reference;

public sealed class Stand : AuditableEntity
{
    public long StationId { get; set; }

    public long? TerminalId { get; set; }

    public string Code { get; set; } = string.Empty;

    public string? StandType { get; set; }

    public bool IsActive { get; set; }
}
