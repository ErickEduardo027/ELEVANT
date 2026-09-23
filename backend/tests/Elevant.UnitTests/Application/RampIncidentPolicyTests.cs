using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class RampIncidentPolicyTests
{
    private static readonly DateTimeOffset Started =
        new(2026, 9, 23, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("Operational")]
    [InlineData("Safety")]
    [InlineData("Equipment")]
    [InlineData("Documentation")]
    public void AcceptsOnlyReviewedTypes(string incidentType)
    {
        Assert.True(RampIncidentPolicy.IsValid(
            incidentType, IncidentSeverity.High, "Equipo fuera de servicio", Started));
        Assert.False(RampIncidentPolicy.IsValid(
            "Other", IncidentSeverity.High, "Equipo fuera de servicio", Started));
    }

    [Theory]
    [InlineData(IncidentSeverity.Low)]
    [InlineData(IncidentSeverity.Medium)]
    [InlineData(IncidentSeverity.High)]
    [InlineData(IncidentSeverity.Critical)]
    public void AcceptsReviewedSeverities(IncidentSeverity severity) =>
        Assert.True(RampIncidentPolicy.IsValid(
            "Safety", severity, "Equipo fuera de servicio", Started));

    [Fact]
    public void RejectsEmptyShortOversizedOrControlCharacterDescriptions()
    {
        foreach (var description in new[] { "", "  corto ", new string('x', 2001), "Daño\0 visible" })
        {
            Assert.False(RampIncidentPolicy.IsValid(
                "Safety", IncidentSeverity.High, description, Started));
        }
    }

    [Fact]
    public void RequiresActiveOperationAndOccurrenceInsideTheExecutionWindow()
    {
        var occurredAt = Started.AddMinutes(2);
        var now = Started.AddMinutes(3);
        Assert.True(RampIncidentPolicy.CanReport(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress,
            Started, null, occurredAt, now));
        Assert.False(RampIncidentPolicy.CanReport(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress,
            Started, null, Started.AddSeconds(-1), now));
        Assert.False(RampIncidentPolicy.CanReport(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress,
            Started, null, now.AddSeconds(1), now));
        Assert.False(RampIncidentPolicy.CanReport(
            TurnaroundStatus.InProgress, GroundOperationStatus.InProgress,
            Started, now, occurredAt, now));
    }
}
