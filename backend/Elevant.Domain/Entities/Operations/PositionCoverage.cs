namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// The stands one ramp agent covers during a window of a shift (ADR-0030). Flights that block on
/// those stands in that window go to this agent. Released coverages are kept as history.
/// </summary>
public sealed class PositionCoverage : AuditableEntity
{
    public long StationId { get; set; }

    public long TerminalId { get; set; }

    public long RampAgentId { get; set; }

    /// <summary>Experienced agent who accompanies an agent with less than three months.</summary>
    public long? MentorRampAgentId { get; set; }

    /// <summary>Vehicle OCC hands over when the agent covers more than two stands.</summary>
    public string? VehicleCode { get; set; }

    /// <summary>A second agent on stands that already have one, marked by OCC (peak hours).</summary>
    public bool IsReinforcement { get; set; }

    public DateTimeOffset StartsAt { get; set; }

    public DateTimeOffset EndsAt { get; set; }

    public DateTimeOffset? ReleasedAt { get; set; }

    public long AssignedByAccountId { get; set; }

    public long? ReleasedByAccountId { get; set; }
}

/// <summary>One stand of a <see cref="PositionCoverage"/>.</summary>
public sealed class PositionCoverageStand : Entity<long>
{
    public long PositionCoverageId { get; set; }

    public long StandId { get; set; }
}
