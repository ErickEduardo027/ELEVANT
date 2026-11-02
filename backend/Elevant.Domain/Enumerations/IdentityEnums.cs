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

/// <summary>Why an email is sent to an account (ADR-0022).</summary>
public enum EmailPurpose
{
    Activation,
    LoginCode,
    PasswordReset,
    Test,
}

/// <summary>Delivery state of an email in the outbox.</summary>
public enum EmailDeliveryStatus
{
    Pending,
    Sent,
    Failed,
}
