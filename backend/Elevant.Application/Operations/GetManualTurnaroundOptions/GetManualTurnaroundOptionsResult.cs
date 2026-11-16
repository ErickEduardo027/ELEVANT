namespace Elevant.Application.Operations.GetManualTurnaroundOptions;

public sealed record GetManualTurnaroundOptionsResult(
    ManualTurnaroundOptionsData? Options, OccPlanningFailure? Failure)
{
    public bool IsSuccess => Options is not null && Failure is null;

    public static GetManualTurnaroundOptionsResult Success(ManualTurnaroundOptionsData options) =>
        new(options, null);

    public static GetManualTurnaroundOptionsResult Failed(OccPlanningFailure failure) =>
        new(null, failure);
}
