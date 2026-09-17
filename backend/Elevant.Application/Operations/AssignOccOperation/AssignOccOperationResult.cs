namespace Elevant.Application.Operations.AssignOccOperation;

public sealed record AssignOccOperationResult(
    OccAssignmentData? Assignment,
    OccPlanningFailure? Failure)
{
    public bool IsSuccess => Assignment is not null && Failure is null;

    public static AssignOccOperationResult Success(OccAssignmentData assignment) =>
        new(assignment, null);

    public static AssignOccOperationResult Failed(OccPlanningFailure failure) =>
        new(null, failure);
}
