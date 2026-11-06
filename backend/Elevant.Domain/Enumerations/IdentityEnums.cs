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
    /// <summary>Signed contract PDF sent when a contract becomes active (ADR-0025).</summary>
    ContractActivated,
    /// <summary>Simulated e-CF invoice PDF sent to the airline when Finance issues it (ADR-0035).</summary>
    InvoiceIssued,
    PaymentReceived,
    /// <summary>Approval, rejection or cancellation of a public commercial request, sent to its applicant.</summary>
    CommercialDecision,
}

/// <summary>Delivery state of an email in the outbox.</summary>
public enum EmailDeliveryStatus
{
    Pending,
    Sent,
    Failed,
    /// <summary>Never sent: its link or code expired, or a newer one replaced it (1-N09).</summary>
    Discarded,
}
