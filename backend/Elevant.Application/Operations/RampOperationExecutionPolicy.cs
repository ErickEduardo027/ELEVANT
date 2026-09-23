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
}
