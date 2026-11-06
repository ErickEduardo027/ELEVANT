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
    /// <summary>Contratos confirmed the validity of a version: the airline can review and sign it (2-N13).</summary>
    ContractReadyToSign,
    /// <summary>Contratos rejected a permit of the airline dossier, with its note (2-N13).</summary>
    PermitRejected,
    /// <summary>Contratos revoked the verification of a permit, with its reason (2-N09).</summary>
    PermitRevoked,
    /// <summary>A verified permit expires within the notice days (2-N12).</summary>
    PermitExpiring,
    /// <summary>The contract ends within the notice days its version signed (2-N12).</summary>
    ContractExpiring,
    /// <summary>The contract was suspended by Contratos or for lack of a usable operating permit (2-N12).</summary>
    ContractSuspended,
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
