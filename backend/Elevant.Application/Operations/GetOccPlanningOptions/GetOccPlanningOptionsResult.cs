namespace Elevant.Application.Operations.GetOccPlanningOptions;

public sealed record GetOccPlanningOptionsResult(
    OccPlanningOptionsData? Options,
    OccPlanningFailure? Failure)
{
    public bool IsSuccess => Options is not null && Failure is null;

    public static GetOccPlanningOptionsResult Success(OccPlanningOptionsData options) =>
        new(options, null);

    public static GetOccPlanningOptionsResult Failed(OccPlanningFailure failure) =>
        new(null, failure);
}
