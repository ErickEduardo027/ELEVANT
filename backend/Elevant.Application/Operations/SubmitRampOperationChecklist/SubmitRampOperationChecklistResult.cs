namespace Elevant.Application.Operations.SubmitRampOperationChecklist;

public sealed record SubmitRampOperationChecklistResult(
    RampChecklistSubmissionData? Submission,
    RampOperationsFailure? Failure)
{
    public bool IsSuccess => Submission is not null && Failure is null;

    public static SubmitRampOperationChecklistResult Success(
        RampChecklistSubmissionData submission) =>
        new(submission, null);

    public static SubmitRampOperationChecklistResult Failed(
        RampOperationsFailure failure) =>
        new(null, failure);
}
