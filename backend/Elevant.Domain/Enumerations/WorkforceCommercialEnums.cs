namespace Elevant.Domain.Enumerations;

public enum PermitDocumentType
{
    AirportId,
    RampDriverLicense,
}

public enum ShiftBlock
{
    Morning,
    Afternoon,
    Night,
}

public enum AvailabilityRequestType
{
    DayOff,
    ShiftChange,
    Restriction,
}

public enum AvailabilityRequestStatus
{
    Pending,
    Approved,
    Rejected,
    Cancelled,
}

public enum CommercialRequestType
{
    Affiliation,
    AdditionalService,
}

public enum CommercialRequestStatus
{
    Pending,
    InReview,
    Approved,
    Rejected,
    Cancelled,
}

public enum ContractStatus
{
    Draft,
    Active,
    Suspended,
    Terminated,
    Expired,
}

public enum ContractVersionStatus
{
    Draft,
    PendingFinanceApproval,
    Approved,
    Superseded,
    /// <summary>Reserved: no flow assigns it; Finance returns a version to Draft instead.</summary>
    Rejected,
}

/// <summary>
/// How a contract is renewed (ADR-0025). Automatic starts the renewal draft by itself
/// <c>RenewalNoticeDays</c> before the end; it still goes through Finance and both signatures.
/// </summary>
public enum ContractRenewalMode
{
    Manual,
    Automatic,
}

/// <summary>Party that accepts a contract version.</summary>
public enum ContractSignatureParty
{
    Aviam,
    Airline,
}

/// <summary>Result of checking an airline against a public registry (ADR-0023).</summary>
public enum AirlineRegistryStatus
{
    /// <summary>Name and codes match an active airline.</summary>
    Found,

    /// <summary>The registry knows the codes, but the name or the other code differ.</summary>
    Mismatch,

    /// <summary>The matching airline has ceased operations.</summary>
    Defunct,

    /// <summary>No registry entry uses these codes.</summary>
    NotFound,
}

/// <summary>Kind of airline permit kept in its dossier (ADR-0024).</summary>
public enum AirlinePermitKind
{
    /// <summary>Operating permit of the civil aviation authority (JAC); activation requires a current one.</summary>
    OperatingPermit,

    /// <summary>Air operator certificate (IDAC / AOC).</summary>
    AirOperatorCertificate,

    /// <summary>Liability insurance policy.</summary>
    Insurance,

    Other,
}

/// <summary>Review of a submitted permit by Contratos.</summary>
public enum AirlinePermitReview
{
    Submitted,
    Verified,
    Rejected,
}
