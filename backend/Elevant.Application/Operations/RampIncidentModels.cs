using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public sealed record RampIncidentData(
    Guid Id,
    string IncidentType,
    string Severity,
    string Status,
    string Description,
    DateTimeOffset OccurredAt,
    DateTimeOffset ReportedAt,
    string? DelayCode = null);

public sealed record RampIncidentReadRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId);

public sealed record RampIncidentReadResult(
    IReadOnlyList<RampIncidentData>? Incidents,
    RampOperationsFailure? Failure)
{
    public bool IsSuccess => Incidents is not null && Failure is null;
    public static RampIncidentReadResult Success(IReadOnlyList<RampIncidentData> incidents) =>
        new(incidents, null);
    public static RampIncidentReadResult Failed(RampOperationsFailure failure) =>
        new(null, failure);
}

public sealed record RampIncidentWriteRequest(
    Guid ActorAccountId,
    IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId,
    string IncidentType,
    IncidentSeverity Severity,
    string Description,
    DateTimeOffset OccurredAt,
    Guid InstallationId,
    Guid IdempotencyKey,
    Guid CorrelationId,
    string? RequestId,
    string? DelayCode = null);

public sealed record RampIncidentReceiptData(
    Guid ReceiptId,
    Guid OperationId,
    Guid IncidentId,
    string Status,
    DateTimeOffset OccurredAt,
    DateTimeOffset ReportedAt);

/// <summary>
/// Outcome of an incident report. <c>Code</c> is the Problem Details code of a refusal the tablet explains
/// (<c>time_outside_operation_window</c>, <c>idempotency_conflict</c>, phase 3 block C); a replay of the device
/// receipt answers the same one.
/// </summary>
public sealed record RampIncidentWriteResult(
    RampIncidentReceiptData? Receipt,
    RampOperationsFailure? Failure,
    Guid? CommitReceiptId,
    string? Code = null)
{
    public bool IsSuccess => Receipt is not null && Failure is null;
    public static RampIncidentWriteResult Success(RampIncidentReceiptData receipt, Guid commitReceiptId) =>
        new(receipt, null, commitReceiptId);
    public static RampIncidentWriteResult Failed(RampOperationsFailure failure, Guid? commitReceiptId = null,
        string? code = null) =>
        new(null, failure, commitReceiptId, code);
}
