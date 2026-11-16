using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Workforce;

/// <summary>
/// Organisational job ("puesto") of one department, owned by Human Resources. It describes what a person
/// is in the company; what the person may do in ELEVANT is an access profile chosen by the department.
/// </summary>
public sealed class JobPosition : AuditableEntity
{
    public Department Department { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>Ramp positions belong to Operations and give the employee a ramp-agent record.</summary>
    public bool IsRampPosition { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>Access profile the department pre-selects when it requests access for this position.</summary>
    public long? SuggestedAccessProfileId { get; set; }

    public long CreatedByAccountId { get; set; }
}

/// <summary>Human Resources record of a person employed by AVIAM. Accounts are only issued to employees.</summary>
public sealed class Employee : AuditableEntity
{
    public long PersonId { get; set; }

    public string EmployeeNumber { get; set; } = string.Empty;

    public Department Department { get; set; }

    public long JobPositionId { get; set; }

    public DateOnly HireDate { get; set; }

    public EmployeeStatus Status { get; set; }

    public DateOnly? TerminatedOn { get; set; }

    public string? TerminationReason { get; set; }

    public long? TerminatedByAccountId { get; set; }

    /// <summary>Personnel requisition this hire fulfilled, when there was one.</summary>
    public long? RequisitionId { get; set; }

    public long CreatedByAccountId { get; set; }
}

/// <summary>Department and position history of an employee; exactly one row is open at a time.</summary>
public sealed class EmployeeAssignment : Entity<long>
{
    public long EmployeeId { get; set; }

    public Department Department { get; set; }

    public long JobPositionId { get; set; }

    public DateTimeOffset ValidFrom { get; set; }

    public DateTimeOffset? ValidTo { get; set; }

    public long ChangedByAccountId { get; set; }

    public string? Reason { get; set; }
}

/// <summary>Station where an employee works; scopes of any account are a subset of these.</summary>
public sealed class EmployeeStation : Entity<long>
{
    public long EmployeeId { get; set; }

    public long StationId { get; set; }

    public DateOnly ValidFrom { get; set; }

    public DateOnly? ValidTo { get; set; }
}

/// <summary>A department's request to Human Resources for people in one position.</summary>
public sealed class PersonnelRequisition : AuditableEntity
{
    public Department Department { get; set; }

    public long JobPositionId { get; set; }

    public int Quantity { get; set; }

    public string Reason { get; set; } = string.Empty;

    public long? StationId { get; set; }

    public DateOnly? DesiredStartOn { get; set; }

    public RequisitionStatus Status { get; set; }

    public long RequestedByAccountId { get; set; }

    public DateTimeOffset RequestedAt { get; set; }

    public long? AttendedByAccountId { get; set; }

    public long? ClosedByAccountId { get; set; }

    public DateTimeOffset? ClosedAt { get; set; }

    public string? ClosureReason { get; set; }
}
