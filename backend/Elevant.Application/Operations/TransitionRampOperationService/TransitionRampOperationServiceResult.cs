namespace Elevant.Application.Operations.TransitionRampOperationService;

/// <summary>
/// Outcome of a service transition; <paramref name="Code"/> names the rule a refusal broke when the tablet can explain
/// it (<c>time_outside_operation_window</c>, <c>service_time_out_of_order</c>, <c>idempotency_conflict</c>, 3-I).
/// </summary>
public sealed record TransitionRampOperationServiceResult(
    RampOperationServiceTransitionData? Transition,
    RampOperationsFailure? Failure,
    string? Code = null)
{
    public bool IsSuccess => Transition is not null && Failure is null;

    public static TransitionRampOperationServiceResult Success(
        RampOperationServiceTransitionData transition) =>
        new(transition, null);

    public static TransitionRampOperationServiceResult Failed(
        RampOperationsFailure failure,
        string? code = null) =>
        new(null, failure, code);
}
