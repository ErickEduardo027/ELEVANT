using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Identity;

/// <summary>Reusable permission template ("plantilla de rol") owned by one department.</summary>
public sealed class AccessProfile : AuditableEntity
{
    public Department Department { get; set; }

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public bool IsActive { get; set; } = true;

    public long CreatedByAccountId { get; set; }
}

/// <summary>Permission code granted by an access profile.</summary>
public sealed class AccessProfileGrant
{
    public long AccessProfileId { get; set; }

    public string PermissionCode { get; set; } = string.Empty;
}

/// <summary>Department and governance level of one internal account.</summary>
public sealed class DepartmentAssignment : AuditableEntity
{
    public long AccountId { get; set; }

    public DepartmentAssignmentKind Kind { get; set; }

    /// <summary>Null only for the super administrator.</summary>
    public Department? Department { get; set; }

    /// <summary>Template whose permissions a member inherits; null uses explicit grants.</summary>
    public long? AccessProfileId { get; set; }
}

/// <summary>Explicit permission of a member that does not follow a template.</summary>
public sealed class AccountPermissionGrant
{
    public long AccountId { get; set; }

    public string PermissionCode { get; set; } = string.Empty;
}

/// <summary>
/// A department administrator's request to create an internal user. Human Resources
/// validates it (creating the account with a temporary password) or rejects it.
/// </summary>
public sealed class UserAccessRequest : AuditableEntity
{
    public Department Department { get; set; }

    public UserAccessRequestKind Kind { get; set; }

    public UserAccessRequestStatus Status { get; set; }

    public long RequestedByAccountId { get; set; }

    public DateTimeOffset RequestedAt { get; set; }

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string Email { get; set; } = string.Empty;

    public string? AvatarMediaUrl { get; set; }

    public long? AccessProfileId { get; set; }

    public string? EmployeeNumber { get; set; }

    public string? Category { get; set; }

    public DateOnly? HireDate { get; set; }

    public long? SupervisorRampAgentId { get; set; }

    public long? DecidedByAccountId { get; set; }

    public DateTimeOffset? DecidedAt { get; set; }

    public string? DecisionReason { get; set; }

    public long? CreatedAccountId { get; set; }
}

public sealed class UserAccessRequestGrant
{
    public long UserAccessRequestId { get; set; }

    public string PermissionCode { get; set; } = string.Empty;
}

public sealed class UserAccessRequestStation
{
    public long UserAccessRequestId { get; set; }

    public long StationId { get; set; }
}

public sealed class UserAccessRequestTerminal
{
    public long UserAccessRequestId { get; set; }

    public long TerminalId { get; set; }
}
