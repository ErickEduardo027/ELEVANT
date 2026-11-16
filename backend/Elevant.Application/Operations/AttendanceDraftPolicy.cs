namespace Elevant.Application.Operations;

public static class AttendanceDraftPolicy
{
    public static bool IsValidLane(AttendanceDraftLane lane) =>
        lane is AttendanceDraftLane.Occ or AttendanceDraftLane.RampAgent;

    public static string? NormalizeNote(string? note) =>
        string.IsNullOrWhiteSpace(note) ? null : note.Trim();

    /// <summary>
    /// 3-F: OCC records the attendance of an open assignment and of one a handover released after the operation started
    /// (the relieved agent worked until then); any other released assignment takes no new attendance.
    /// </summary>
    public static bool AcceptsOccAttendance(DateTimeOffset? releasedAt, DateTimeOffset? actualStartAt) =>
        releasedAt is not { } released || actualStartAt is { } started && released > started;

    public static bool IsValid(
        int expectedRevision,
        DateTimeOffset? observedStartAt,
        DateTimeOffset? observedEndAt,
        string? incidentNote)
    {
        var note = NormalizeNote(incidentNote);
        return expectedRevision >= 0 &&
            (observedStartAt is not null || observedEndAt is not null || note is not null) &&
            (observedStartAt is null || observedStartAt.Value != default) &&
            (observedEndAt is null || observedEndAt.Value != default) &&
            (observedStartAt is null || observedEndAt is null ||
                observedEndAt.Value.ToUniversalTime() >= observedStartAt.Value.ToUniversalTime()) &&
            (note is null ||
                (note.Length <= 2000 &&
                    !note.Any(character => char.IsControl(character) &&
                        character is not ('\t' or '\n' or '\r'))));
    }
}
