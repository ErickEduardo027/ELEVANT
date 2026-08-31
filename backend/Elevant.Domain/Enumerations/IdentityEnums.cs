namespace Elevant.Domain.Enumerations;

public enum OrganizationType
{
    AviamOperator,
    AirlineCustomer,
}

public enum OrganizationStatus
{
    Active,
    Inactive,
}

public enum AccountLifecycleStatus
{
    Active,
    PendingActivation,
    InvitationSent,
    Disabled,
    Blocked,
}

public enum InvitationStatus
{
    NotSent,
    Sent,
    Expired,
    Accepted,
}

public enum PortalKind
{
    BackOffice,
    RampMobileApp,
    AirlinePortal,
}

public enum MembershipKind
{
    InternalStaff,
    AirlineClient,
}

public enum MembershipStatus
{
    Active,
    Suspended,
    Ended,
}
