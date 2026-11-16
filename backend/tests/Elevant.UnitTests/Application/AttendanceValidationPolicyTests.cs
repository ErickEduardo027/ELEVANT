using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

public sealed class AttendanceValidationPolicyTests
{
    private static readonly DateTimeOffset OccStart =
        new(2026, 10, 2, 8, 0, 0, TimeSpan.FromHours(-4));
    private static readonly DateTimeOffset RampStart = OccStart.AddMinutes(5);
    private static readonly DateTimeOffset OccEnd = OccStart.AddHours(2);
    private static readonly DateTimeOffset RampEnd = RampStart.AddHours(2);

    [Fact]
    public void SelectsOnlyRecordedValuesAndNormalizesInstants()
    {
        var result = AttendanceValidationPolicy.Resolve(
            Contribution(1, OccStart.AddTicks(9_999), OccEnd),
            Contribution(2, RampStart, RampEnd.AddTicks(9_999)),
            "Occ", "RampAgent", "  Demora revisada  ");

        Assert.Null(result.Failure);
        Assert.Equal(new DateTimeOffset(2026, 10, 2, 12, 0, 0, TimeSpan.Zero),
            result.StartAt);
        Assert.Equal(new DateTimeOffset(2026, 10, 2, 14, 5, 0, TimeSpan.Zero),
            result.EndAt);
        Assert.Equal("Demora revisada", result.Reason);
    }

    [Fact]
    public void RequiresReasonWhenEitherObservationDiffers()
    {
        var result = AttendanceValidationPolicy.Resolve(
            Contribution(1, OccStart, OccEnd),
            Contribution(1, RampStart, RampEnd), "Occ", "RampAgent", " \t ");

        Assert.Equal(AttendanceValidationFailure.Invalid, result.Failure);
    }

    [Fact]
    public void AllowsMatchingObservationsWithoutReason()
    {
        var result = AttendanceValidationPolicy.Resolve(
            Contribution(1, OccStart, OccEnd),
            Contribution(1, OccStart.ToUniversalTime(), OccEnd.ToUniversalTime()),
            "Occ", "RampAgent", null);

        Assert.Null(result.Failure);
        Assert.Null(result.Reason);
    }

    [Fact]
    public void RejectsMissingLaneOrUnobservedChosenHito()
    {
        var occ = Contribution(1, OccStart, OccEnd);
        var rampWithoutEnd = Contribution(1, RampStart, null);

        Assert.Equal(AttendanceValidationFailure.Invalid,
            AttendanceValidationPolicy.Resolve(occ, null, "Occ", "Occ", "Motivo").Failure);
        Assert.Equal(AttendanceValidationFailure.Invalid,
            AttendanceValidationPolicy.Resolve(occ, rampWithoutEnd,
                "Occ", "RampAgent", "Motivo").Failure);
    }

    [Theory]
    [InlineData("Other", "Occ")]
    [InlineData("Occ", "Other")]
    [InlineData("occ", "RampAgent")]
    public void RejectsUnrecognizedSource(string startSource, string endSource)
    {
        var result = AttendanceValidationPolicy.Resolve(
            Contribution(1, OccStart, OccEnd),
            Contribution(1, RampStart, RampEnd),
            startSource, endSource, "Motivo");

        Assert.Equal(AttendanceValidationFailure.Invalid, result.Failure);
    }

    [Fact]
    public void RejectsChronologyReversedByCrossLaneSelection()
    {
        var result = AttendanceValidationPolicy.Resolve(
            Contribution(1, OccStart.AddHours(3), OccStart.AddHours(4)),
            Contribution(1, RampStart, RampEnd),
            "Occ", "RampAgent", "Motivo");

        Assert.Equal(AttendanceValidationFailure.Invalid, result.Failure);
    }

    [Fact]
    public void BoundsReasonAndRejectsEmbeddedControlCharacters()
    {
        var occ = Contribution(1, OccStart, OccEnd);
        var ramp = Contribution(1, RampStart, RampEnd);

        Assert.Null(AttendanceValidationPolicy.Resolve(occ, ramp, "Occ", "Occ",
            new string('x', 1000)).Failure);
        Assert.Equal(AttendanceValidationFailure.Invalid,
            AttendanceValidationPolicy.Resolve(occ, ramp, "Occ", "Occ",
                new string('x', 1001)).Failure);
        Assert.Equal(AttendanceValidationFailure.Invalid,
            AttendanceValidationPolicy.Resolve(occ, ramp, "Occ", "Occ",
                "Dato\0alterado").Failure);
    }

    private static AttendanceDraftContributionData Contribution(
        int revision, DateTimeOffset? start, DateTimeOffset? end) =>
        new(revision, Guid.Parse("40000000-0000-7000-8000-000000000001"),
            new DateTimeOffset(2026, 10, 2, 15, 0, 0, TimeSpan.Zero),
            start, end, "Observación manual");
}
