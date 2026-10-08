namespace Elevant.Domain.Entities.Operations;

/// <summary>
/// Charge a ramp agent marked on an executed service. The agent only chooses the
/// charge; Finance values it from the charge tariff and the recorded times.
/// </summary>
public sealed class OperationServiceCharge : AuditableEntity
{
    public long OperationServiceId { get; set; }

    public long ChargeDefinitionId { get; set; }

    public long AppliedByRampAgentId { get; set; }

    public DateTimeOffset AppliedAt { get; set; }

    public DateTimeOffset? RemovedAt { get; set; }

    public long? RemovedByRampAgentId { get; set; }
}
