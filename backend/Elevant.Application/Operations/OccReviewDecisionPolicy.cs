namespace Elevant.Application.Operations;

public static class OccReviewDecisionPolicy
{
    public static bool HasValidRequest(string? outcome, string? reason) =>
        outcome switch
        {
            "Approved" => string.IsNullOrWhiteSpace(reason),
            "Returned" => IsValidReason(reason, 2000),
            _ => false,
        };

    public static bool CanDecide(string operationStatus, string submissionStatus) =>
        operationStatus == "PendingReview" && submissionStatus == "PendingReview";

    /// <summary>
    /// 3-H: OCC reopens an approval, as a new revision, only while the operation and its latest hand-off are approved
    /// (whether anything was invoiced from it is the store's check).
    /// </summary>
    public static bool CanReopen(string operationStatus, string submissionStatus) =>
        operationStatus == "Approved" && submissionStatus == "Approved";

    /// <summary>
    /// 3-H: a reopened revision is decided again in OCC only. The approval already freed its agent and its stand
    /// (3-D) and closed its turnaround, so there is nobody on the ramp to correct it.
    /// </summary>
    public static bool CanReturn(bool isReopened) => !isReopened;

    /// <summary>The reason of a reopening: 8 to 2000 characters without control characters.</summary>
    public static string? ReopenReason(string? reason) => IsValidReason(reason, 2000) ? reason!.Trim() : null;

    private static bool IsValidReason(string? reason, int maximum) =>
        reason is not null &&
        reason.Trim().Length >= 8 && reason.Trim().Length <= maximum &&
        !reason.Any(character =>
            (character < ' ' && character is not ('\n' or '\r' or '\t')) ||
            character == '\u007f');
}
