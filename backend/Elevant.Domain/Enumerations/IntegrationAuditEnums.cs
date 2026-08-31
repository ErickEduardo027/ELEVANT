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
