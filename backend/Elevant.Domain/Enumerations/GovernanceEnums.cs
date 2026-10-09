namespace Elevant.Domain.Enumerations;

/// <summary>Internal AVIAM department that owns a set of back-office modules.</summary>
public enum Department
{
    HumanResources,
    Contracts,
    Operations,
    Finance,
}

/// <summary>Governance level of an internal account.</summary>
public enum DepartmentAssignmentKind
{
    /// <summary>The single global governance account. It belongs to no department.</summary>
    SuperAdministrator,

    /// <summary>Full access to every module of one department; manages its members.</summary>
    Administrator,

    /// <summary>Access limited to the permissions of a template or an explicit grant set.</summary>
    Member,
}

public enum UserAccessRequestStatus
{
    Pending,
    Validated,
    Rejected,
    Cancelled,
}

public enum UserAccessRequestKind
{
    /// <summary>AVIAM Web user of the requesting department.</summary>
    BackOfficeUser,

    /// <summary>Ramp agent of the Operations department that signs in to the mobile app.</summary>
    RampAgent,
}

/// <summary>Employment status kept by Human Resources; a terminated employee can hold no active account.</summary>
public enum EmployeeStatus
{
    Active,
    Terminated,
}

/// <summary>Lifecycle of a personnel requisition.</summary>
public enum RequisitionStatus
{
    Open,
    InProgress,
    Fulfilled,
    Rejected,
    Cancelled,
}
