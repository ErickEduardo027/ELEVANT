namespace Elevant.Domain.Enumerations;

public enum TurnaroundStatus
{
    Scheduled,
    Confirmed,
    InProgress,
    Completed,
    Cancelled,
    Diverted,
}

public enum FlightDirection
{
    Arrival,
    Departure,
}

public enum OperationalDataSource
{
    Internal,
    Manual,
    AirlineClient,
    ExternalProvider,
}

public enum GroundOperationStatus
{
    Planned,
    Assigned,
    InProgress,
    PendingReview,
    InReview,
    Approved,
    Returned,
    Cancelled,
}

public enum ServiceExecutionStatus
{
    Planned,
    InProgress,
    Completed,
    NotPerformed,
    Exception,
}

public enum MilestoneStatus
{
    Pending,
    Estimated,
    Actual,
    Missed,
}

public enum ChecklistVersionStatus
{
    Draft,
    Published,
    Retired,
}

public enum ChecklistStatus
{
    NotStarted,
    InProgress,
    Submitted,
}

public enum ChecklistAnswerValue
{
    Ok,
    NotApplicable,
    NotOk,
}

public enum IncidentSeverity
{
    Low,
    Medium,
    High,
    Critical,
}

public enum IncidentStatus
{
    Open,
    InReview,
    Resolved,
    Closed,
}

public enum SubmissionStatus
{
    PendingReview,
    InReview,
    Approved,
    Returned,
}

public enum ReviewOutcome
{
    Approved,
    Returned,
}

public enum OperationalRequestStatus
{
    Submitted,
    InReview,
    Accepted,
    Rejected,
    Completed,
    Cancelled,
}
