namespace Elevant.Application.Operations;

public static class OccReviewDecisionPolicy
{
    public static bool HasValidRequest(string? outcome, string? reason) =>
        outcome switch
        {
            "Approved" => string.IsNullOrWhiteSpace(reason),
            "Returned" => reason is not null &&
                reason.Trim().Length is >= 8 and <= 2000 &&
                !reason.Any(character =>
                    (character < ' ' && character is not ('\n' or '\r' or '\t')) ||
                    character == '\u007f'),
            _ => false,
        };

    public static bool CanDecide(string operationStatus, string submissionStatus) =>
        operationStatus == "PendingReview" && submissionStatus == "PendingReview";
}
