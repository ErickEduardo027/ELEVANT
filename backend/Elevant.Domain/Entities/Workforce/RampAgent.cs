namespace Elevant.Domain.Entities.Workforce;

public sealed class RampAgent : AuditableEntity
{
    public long PersonId { get; set; }

    public string EmployeeNumber { get; set; } = string.Empty;

    public string Category { get; set; } = string.Empty;

    public DateOnly HireDate { get; set; }

    public long? SupervisorAgentId { get; set; }

    public bool IsActive { get; set; }
}
