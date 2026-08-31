namespace Elevant.Domain.Entities.Workforce;

public sealed class QualificationCycle : AuditableEntity
{
    public long RampAgentId { get; set; }

    public long EquipmentTypeId { get; set; }

    public int CycleNumber { get; set; }

    public DateOnly TrainingDate { get; set; }

    public DateOnly ObtainedOn { get; set; }

    public DateOnly ExpiresOn { get; set; }

    public string CertifyingEntity { get; set; } = string.Empty;

    public string InstructorName { get; set; } = string.Empty;

    public string? Notes { get; set; }

    public long? SupersedesQualificationId { get; set; }

    public bool IsCurrent { get; set; }
}
