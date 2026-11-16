namespace Elevant.Domain.Entities.Reference;

public sealed class Terminal : AuditableEntity
{
    public long StationId { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    /// <summary>Most stands one agent may cover at once here (ADR-0030); null uses the default of 3.</summary>
    public int? MaxStandsPerAgent { get; set; }

    /// <summary>Covering this terminal needs a current boarding-bridge qualification (Terminal B).</summary>
    public bool RequiresBridgeQualification { get; set; }
}
