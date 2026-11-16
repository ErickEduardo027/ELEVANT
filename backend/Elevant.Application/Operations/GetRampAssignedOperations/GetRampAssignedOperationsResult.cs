namespace Elevant.Application.Operations.GetRampAssignedOperations;

public sealed record GetRampAssignedOperationsResult(
    IReadOnlyList<RampAssignedOperationData>? Operations,
    RampOperationsFailure? Failure)
{
    public bool IsSuccess => Operations is not null && Failure is null;

    public static GetRampAssignedOperationsResult Success(
        IReadOnlyList<RampAssignedOperationData> operations)
    {
        ArgumentNullException.ThrowIfNull(operations);
        return new(operations, null);
    }

    public static GetRampAssignedOperationsResult Failed(RampOperationsFailure failure) =>
        new(null, failure);
}
