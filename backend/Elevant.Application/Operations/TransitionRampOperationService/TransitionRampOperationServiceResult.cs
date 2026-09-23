namespace Elevant.Application.Operations.TransitionRampOperationService;

public sealed record TransitionRampOperationServiceResult(
    RampOperationServiceTransitionData? Transition,
    RampOperationsFailure? Failure)
{
    public bool IsSuccess => Transition is not null && Failure is null;

    public static TransitionRampOperationServiceResult Success(
        RampOperationServiceTransitionData transition) =>
        new(transition, null);

    public static TransitionRampOperationServiceResult Failed(
        RampOperationsFailure failure) =>
        new(null, failure);
}
