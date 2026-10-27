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
    Rejected,
}

/// <summary>Party that accepts a contract version.</summary>
public enum ContractSignatureParty
{
    Aviam,
    Airline,
}
