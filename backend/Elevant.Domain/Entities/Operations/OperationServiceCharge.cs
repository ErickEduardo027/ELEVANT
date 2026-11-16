using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// Charge marked on an executed service. The agent only chooses the charge; Finance values it
/// from the charge tariff and the recorded times. ELEVANT also marks the automatic surcharges
/// when the operation is handed to OCC, and OCC can add or remove one with a reason (ADR-0034).
/// </summary>
public sealed class OperationServiceCharge : AuditableEntity
{
    public long OperationServiceId { get; set; }

    public long ChargeDefinitionId { get; set; }

    public ChargeMarkSource Source { get; set; } = ChargeMarkSource.Agent;

    /// <summary>The agent who marked it; null for automatic and OCC marks.</summary>
    public long? AppliedByRampAgentId { get; set; }

    /// <summary>The OCC reviewer who added it.</summary>
    public long? AppliedByAccountId { get; set; }

    public DateTimeOffset AppliedAt { get; set; }

    public DateTimeOffset? RemovedAt { get; set; }

    public long? RemovedByRampAgentId { get; set; }

    /// <summary>The OCC reviewer who removed it.</summary>
    public long? RemovedByAccountId { get; set; }

    /// <summary>Why OCC added or removed it.</summary>
    public string? AdjustmentReason { get; set; }
}
