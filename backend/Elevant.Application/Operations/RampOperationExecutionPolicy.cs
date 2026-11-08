using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public static class RampOperationExecutionPolicy
{
    public static bool CanExecute(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt) =>
        turnaroundStatus is TurnaroundStatus.Confirmed or TurnaroundStatus.InProgress &&
        operationStatus == GroundOperationStatus.InProgress &&
        actualStartAt is not null &&
        actualEndAt is null;

    /// <summary>
    /// Evidence captured on the tablet before the hand-off that reached the server after it (3-N06): while OCC has not
    /// decided, the handed-off operation still takes its milestones, walk-around damages and flight data. Once OCC
    /// approves or returns it nothing late is taken.
    /// </summary>
    public static bool AcceptsLateEvidence(
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt) =>
        operationStatus == GroundOperationStatus.PendingReview &&
        actualStartAt is not null &&
        actualEndAt is not null;

    /// <summary>The operation takes Flight Report evidence: live execution, or late evidence while OCC reviews it.</summary>
    public static bool AcceptsEvidence(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt) =>
        CanExecute(turnaroundStatus, operationStatus, actualStartAt, actualEndAt) ||
        AcceptsLateEvidence(operationStatus, actualStartAt, actualEndAt);
}
