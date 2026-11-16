namespace Elevant.Application.Operations.StartRampOperation;

/// <summary>
/// Outcome of «Iniciar»; <paramref name="Code"/> is the Problem Details code of a refusal the tablet explains
/// (<c>contract_not_in_force</c>, 3-N04; <c>time_outside_operation_window</c> and <c>idempotency_conflict</c>, 3-I).
/// The status stays the one the deployed APK knows.
/// </summary>
public sealed record StartRampOperationResult(
    RampOperationStartData? Start,
    RampOperationsFailure? Failure,
    string? Code = null)
{
    public bool IsSuccess => Start is not null && Failure is null;

    public static StartRampOperationResult Success(RampOperationStartData start) =>
        new(start, null);

    public static StartRampOperationResult Failed(RampOperationsFailure failure, string? code = null) =>
        new(null, failure, code);
}
