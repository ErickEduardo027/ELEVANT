using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

public static class RampOperationServiceTransitionPolicy
{
    public const int MaximumNoteLength = 1000;
    public const decimal MaximumExecutedQuantity = 99_999_999_999_999.9999m;

    public static bool HasValidRequestShape(
        ServiceExecutionStatus targetStatus,
        decimal? executedQuantity,
        string? note)
    {
        if (!Enum.IsDefined(targetStatus) ||
            targetStatus == ServiceExecutionStatus.Planned ||
            note?.Length > MaximumNoteLength)
        {
            return false;
        }

        if (targetStatus == ServiceExecutionStatus.InProgress)
        {
            return executedQuantity is null;
        }

        if (executedQuantity is not decimal quantity ||
            quantity < 0m ||
            quantity > MaximumExecutedQuantity ||
            GetScale(quantity) > 4)
        {
            return false;
        }

        return targetStatus switch
        {
            ServiceExecutionStatus.NotPerformed =>
                quantity == 0m && !string.IsNullOrWhiteSpace(note),
            ServiceExecutionStatus.Exception => !string.IsNullOrWhiteSpace(note),
            ServiceExecutionStatus.Completed => true,
            _ => false,
        };
    }

    public static bool CanTransition(
        TurnaroundStatus turnaroundStatus,
        GroundOperationStatus operationStatus,
        DateTimeOffset? actualStartAt,
        DateTimeOffset? actualEndAt,
        ServiceExecutionStatus currentStatus,
        ServiceExecutionStatus targetStatus,
        decimal? executedQuantity,
        string? note,
        bool isCorrectionRound = false)
    {
        if (!RampOperationExecutionPolicy.CanExecute(
                turnaroundStatus,
                operationStatus,
                actualStartAt,
                actualEndAt) ||
            !HasValidRequestShape(targetStatus, executedQuantity, note))
        {
            return false;
        }

        return currentStatus switch
        {
            ServiceExecutionStatus.Planned =>
                targetStatus is ServiceExecutionStatus.InProgress or
                    ServiceExecutionStatus.NotPerformed or
                    ServiceExecutionStatus.Exception,
            ServiceExecutionStatus.InProgress =>
                targetStatus is ServiceExecutionStatus.Completed or
                    ServiceExecutionStatus.NotPerformed or
                    ServiceExecutionStatus.Exception,
            ServiceExecutionStatus.Completed or ServiceExecutionStatus.NotPerformed or
                ServiceExecutionStatus.Exception =>
                isCorrectionRound && targetStatus == ServiceExecutionStatus.InProgress &&
                !string.IsNullOrWhiteSpace(note),
            _ => false,
        };
    }

    private static int GetScale(decimal value) =>
        (decimal.GetBits(value)[3] >> 16) & 0x7F;
}
