using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public static class RampOperationStartPolicy
{
    public static bool CanStart(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt) =>
        turnaroundStatus is TurnaroundStatus.Confirmed or TurnaroundStatus.InProgress &&
        operationStatus == GroundOperationStatus.Assigned &&
        actualStartAt is null &&
        actualEndAt is null;
}
