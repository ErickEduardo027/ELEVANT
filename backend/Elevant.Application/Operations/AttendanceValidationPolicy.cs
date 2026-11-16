namespace Elevant.Application.Operations;

public static class AttendanceValidationPolicy
{
    public static AttendanceValidationSelectionResult Resolve(
        AttendanceDraftContributionData? occ,
        AttendanceDraftContributionData? rampAgent,
        string startSource,
        string endSource,
        string? reason)
    {
        if (occ is null || rampAgent is null || occ.Revision < 1 ||
            rampAgent.Revision < 1 || !IsSource(startSource) || !IsSource(endSource))
            return AttendanceValidationSelectionResult.Invalid();

        var start = startSource == "Occ" ? occ.ObservedStartAt : rampAgent.ObservedStartAt;
        var end = endSource == "Occ" ? occ.ObservedEndAt : rampAgent.ObservedEndAt;
        var normalizedReason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        if (start is null || end is null || start.Value == default || end.Value == default ||
            end.Value.ToUniversalTime() < start.Value.ToUniversalTime() ||
            normalizedReason is { Length: > 1000 } ||
            normalizedReason?.Any(character => char.IsControl(character) &&
                character is not ('\t' or '\n' or '\r')) == true)
            return AttendanceValidationSelectionResult.Invalid();

        var startDiffers = occ.ObservedStartAt?.ToUniversalTime() !=
            rampAgent.ObservedStartAt?.ToUniversalTime();
        var endDiffers = occ.ObservedEndAt?.ToUniversalTime() !=
            rampAgent.ObservedEndAt?.ToUniversalTime();
        if ((startDiffers || endDiffers) && normalizedReason is null)
            return AttendanceValidationSelectionResult.Invalid();

        return new AttendanceValidationSelectionResult(Normalize(start.Value),
            Normalize(end.Value), normalizedReason, null);
    }

    private static bool IsSource(string source) => source is "Occ" or "RampAgent";

    private static DateTimeOffset Normalize(DateTimeOffset instant)
    {
        var utc = instant.ToUniversalTime();
        return new DateTimeOffset(utc.Ticks - utc.Ticks % TimeSpan.TicksPerMillisecond,
            TimeSpan.Zero);
    }
}
