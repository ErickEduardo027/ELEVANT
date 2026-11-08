namespace Elevant.Application.Operations;

/// <summary>
/// Stable Problem Details codes of the ramp (tablet) commands (phase 3, block C). A rejection keeps the status the
/// deployed APK already explains (400, 404, 409); the code tells the new one why. The device receipt stores the code,
/// so the same key with the same body answers the same one.
/// </summary>
public static class RampProblemCodes
{
    /// <summary>A time the tablet captured falls outside the operation's evidence window (3-I, 3-N25).</summary>
    public const string TimeOutsideOperationWindow = "time_outside_operation_window";

    /// <summary>Block-on would come after push-back: the pair that decides the surcharges is inverted (3-N25).</summary>
    public const string MilestoneOutOfOrder = "milestone_out_of_order";

    /// <summary>A service transition is earlier than the service's last recorded transition (3-I).</summary>
    public const string ServiceTimeOutOfOrder = "service_time_out_of_order";

    /// <summary>The command does not fit the operation's current state (closed, approved, not started…).</summary>
    public const string StateConflict = "ramp_operation_state_conflict";

    /// <summary>The request is malformed: unknown or missing fields, an invalid header, an impossible value.</summary>
    public const string InvalidCommand = "invalid_ramp_command";

    /// <summary>The Idempotency-Key was already used on this device with another body or command.</summary>
    public const string IdempotencyConflict = "idempotency_conflict";

    /// <summary>The operation, service or mark is not the agent's (or does not exist).</summary>
    public const string NotFound = "not_found";

    /// <summary>The receipt code of a rejection whose cause the tablet explains by its status alone.</summary>
    public const string GenericConflict = "conflict";

    /// <summary>
    /// The code a refusal shows: the generic receipt codes (<c>not_found</c>, <c>conflict</c>) are explained by the
    /// controller's default for their status, any other one travels as is.
    /// </summary>
    public static string? PublicCode(string? receiptCode) =>
        receiptCode is null or NotFound or GenericConflict ? null : receiptCode;
}
