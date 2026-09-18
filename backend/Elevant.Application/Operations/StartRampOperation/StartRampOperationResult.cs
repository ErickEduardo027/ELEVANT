namespace Elevant.Application.Operations.StartRampOperation;

public sealed record StartRampOperationResult(
    RampOperationStartData? Start,
    RampOperationsFailure? Failure)
{
    public bool IsSuccess => Start is not null && Failure is null;

    public static StartRampOperationResult Success(RampOperationStartData start) =>
        new(start, null);

    public static StartRampOperationResult Failed(RampOperationsFailure failure) =>
        new(null, failure);
}
