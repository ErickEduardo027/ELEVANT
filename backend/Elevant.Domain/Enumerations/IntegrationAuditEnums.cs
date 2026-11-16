namespace Elevant.Domain.Enumerations;

public enum MobilePlatform
{
    Android,
    Ios,
}

public enum MobileCommandStatus
{
    Received,
    Processed,
    Rejected,
    Failed,
}

public enum AuditActorType
{
    Account,
    System,
    Integration,
}

public enum AuditSource
{
    Api,
    MobileSync,
    BackgroundJob,
    DatabaseTool,
}

/// <summary>How a paid provider call ended (ADR-0028).</summary>
public enum ProviderCallOutcome
{
    Succeeded,
    NoContent,
    RateLimited,
    QuotaExceeded,
    Unauthorized,
    Failed,
}

/// <summary>Why a paid provider call was made.</summary>
public enum ProviderCallTrigger
{
    Scheduled,
    Manual,

    /// <summary>A screen asked for reference data the cache did not hold (ADR-0028, note of 15 November 2026).</summary>
    OnDemand,
}

public enum ExternalFlightProposalStatus
{
    Proposed,
    Confirmed,
    Dismissed,
}
