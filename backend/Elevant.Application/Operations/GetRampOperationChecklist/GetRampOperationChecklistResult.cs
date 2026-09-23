namespace Elevant.Application.Operations.GetRampOperationChecklist;

public sealed record GetRampOperationChecklistResult(
    RampOperationChecklistData? Checklist,
    RampOperationsFailure? Failure)
{
    public bool IsSuccess => Checklist is not null && Failure is null;

    public static GetRampOperationChecklistResult Success(
        RampOperationChecklistData checklist) =>
        new(checklist, null);

    public static GetRampOperationChecklistResult Failed(
        RampOperationsFailure failure) =>
        new(null, failure);
}
