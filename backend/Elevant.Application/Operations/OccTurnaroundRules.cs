using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// What OCC may change on a turnaround (3-A, 3-B, 3-N08, 3-N21). A flight is rescheduled, cancelled or diverted only
/// before its operation starts: what was executed is closed through the review and what was invoiced with a credit
/// note. The arrival is corrected and the aircraft type changed only until the first submission. Nothing is deleted.
/// </summary>
public static class OccTurnaroundRules
{
    public const string RescheduleAction = "reschedule";
    public const string CancelAction = "cancel";
    public const string DivertAction = "divert";
    public const string CorrectArrivalAction = "correctArrival";

    public const int MinReasonLength = 5;
    public const int MaxReasonLength = 500;

    /// <summary>The longest turnaround OCC plans: the departure at most a day after the arrival.</summary>
    public static readonly TimeSpan MaxGroundTime = TimeSpan.FromHours(24);

    public static bool IsClosed(TurnaroundStatus status) =>
        status is TurnaroundStatus.Completed or TurnaroundStatus.Cancelled or TurnaroundStatus.Diverted;

    /// <summary>The operation began on the ramp (or ended): it is no longer a plan.</summary>
    public static bool HasStarted(GroundOperationStatus? status) =>
        status is not (null or GroundOperationStatus.Planned or GroundOperationStatus.Assigned);

    public static bool CanChangeBeforeStart(TurnaroundStatus turnaround, GroundOperationStatus? operation) =>
        !IsClosed(turnaround) && !HasStarted(operation);

    /// <summary>Why a reschedule, cancellation or diversion is refused; null when it is allowed.</summary>
    public static string? BeforeStartFailure(TurnaroundStatus turnaround, GroundOperationStatus? operation) =>
        IsClosed(turnaround) ? "turnaround_closed" : HasStarted(operation) ? "operation_started" : null;

    /// <summary>Cancelled or Diverted, by name only (never a number).</summary>
    public static TurnaroundStatus? ParseOutcome(string? value) => value switch
    {
        nameof(TurnaroundStatus.Cancelled) => TurnaroundStatus.Cancelled,
        nameof(TurnaroundStatus.Diverted) => TurnaroundStatus.Diverted,
        _ => null,
    };

    /// <summary>The trimmed reason, or null when it is missing, shorter than 5 or longer than 500 characters.</summary>
    public static string? Reason(string? value) =>
        value?.Trim() is { Length: >= MinReasonLength and <= MaxReasonLength } text ? text : null;

    /// <summary>The planned window of a turnaround: UTC instants, the departure after the arrival, within a day.</summary>
    public static bool IsValidSchedule(DateTimeOffset arrivalScheduledAt, DateTimeOffset departureScheduledAt) =>
        arrivalScheduledAt.Offset == TimeSpan.Zero && departureScheduledAt.Offset == TimeSpan.Zero &&
        departureScheduledAt > arrivalScheduledAt && departureScheduledAt - arrivalScheduledAt <= MaxGroundTime;

    /// <summary>
    /// The arrival is recorded or corrected only before the first submission: the operation planned, assigned or in
    /// progress and nothing handed to OCC yet (3-N08). After it the time is evidence whoever wrote it, OCC or the flight
    /// feed, and even when the leg has none (<c>arrival_locked</c>).
    /// </summary>
    public static bool CanCorrectArrival(TurnaroundStatus turnaround, GroundOperationStatus? operation, bool hasSubmission) =>
        !IsClosed(turnaround) && !hasSubmission &&
        operation is null or GroundOperationStatus.Planned or GroundOperationStatus.Assigned or GroundOperationStatus.InProgress;

    /// <summary>
    /// Recording the arrival replaces a time already on the leg, so it needs its reason (3-N08): any new record of an
    /// arrival OCC recorded, and a time other than the one the flight feed reported. The leg's first time, or OCC
    /// keeping the feed's time, needs none.
    /// </summary>
    /// <param name="recorded">The leg's actual arrival now, OCC's or the feed's; null when it has none.</param>
    /// <param name="recordedByOcc">That time is OCC's record (the leg is <c>Manual</c>).</param>
    /// <param name="arrivedAt">The time OCC records now.</param>
    public static bool ArrivalNeedsReason(DateTimeOffset? recorded, bool recordedByOcc, DateTimeOffset arrivedAt) =>
        recorded is { } previous && (recordedByOcc || previous != arrivedAt);

    /// <summary>The aircraft type is frozen from the first submission (3-B): the evidence priced it.</summary>
    public static bool IsAircraftTypeLocked(GroundOperationStatus? operation, bool hasSubmission) =>
        hasSubmission || operation is GroundOperationStatus.PendingReview or GroundOperationStatus.InReview or
            GroundOperationStatus.Approved;

    /// <summary>The changes a screen may offer on the turnaround now; the server checks them again.</summary>
    public static IReadOnlyList<string> AllowedActions(TurnaroundStatus turnaround, GroundOperationStatus? operation,
        bool arrived, bool hasSubmission)
    {
        var actions = new List<string>();
        if (CanChangeBeforeStart(turnaround, operation))
            actions.AddRange([RescheduleAction, CancelAction, DivertAction]);
        if (arrived && CanCorrectArrival(turnaround, operation, hasSubmission)) actions.Add(CorrectArrivalAction);
        return actions;
    }

    /// <summary>The name of a carrier OCC registers for a charter (3-N21): 2 to 160 characters.</summary>
    public static string? AirlineName(string? value)
    {
        var text = value is null ? null : string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return text is { Length: >= 2 and <= 160 } ? text : null;
    }

    /// <summary>The ICAO designator, required: three letters (<c>ref.airlines.icao_code</c> is char(3)).</summary>
    public static string? AirlineIcao(string? value) =>
        value?.Trim().ToUpperInvariant() is { Length: 3 } code && code.All(c => c is >= 'A' and <= 'Z') ? code : null;

    /// <summary>The optional IATA designator: two letters or digits; empty means none.</summary>
    public static bool TryAirlineIata(string? value, out string? iata)
    {
        iata = null;
        if (string.IsNullOrWhiteSpace(value)) return true;
        var code = value.Trim().ToUpperInvariant();
        if (code.Length != 2 || !code.All(c => c is >= 'A' and <= 'Z' or >= '0' and <= '9')) return false;
        iata = code;
        return true;
    }
}
