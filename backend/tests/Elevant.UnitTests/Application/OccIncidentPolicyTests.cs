using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>3-G: how OCC moves an incident, with its note, and when it reports one.</summary>
public sealed class OccIncidentPolicyTests
{
    [Theory]
    [InlineData(IncidentStatus.Open, IncidentStatus.InReview, true)]
    [InlineData(IncidentStatus.Open, IncidentStatus.Resolved, true)]
    [InlineData(IncidentStatus.InReview, IncidentStatus.Resolved, true)]
    [InlineData(IncidentStatus.Resolved, IncidentStatus.Closed, true)]
    [InlineData(IncidentStatus.Resolved, IncidentStatus.InReview, true)]
    [InlineData(IncidentStatus.Open, IncidentStatus.Closed, false)]
    [InlineData(IncidentStatus.InReview, IncidentStatus.Open, false)]
    [InlineData(IncidentStatus.InReview, IncidentStatus.InReview, false)]
    [InlineData(IncidentStatus.Closed, IncidentStatus.InReview, false)]
    [InlineData(IncidentStatus.Closed, IncidentStatus.Resolved, false)]
    public void ClosedIsFinalAndAResolvedOneMayGoBackToReview(IncidentStatus from, IncidentStatus to, bool allowed) =>
        Assert.Equal(allowed, OccIncidentPolicy.CanTransition(from, to));

    [Fact]
    public void TheNextStatesFollowTheTransitions()
    {
        Assert.Equal([IncidentStatus.InReview, IncidentStatus.Resolved], OccIncidentPolicy.NextStatuses(IncidentStatus.Open));
        Assert.Equal([IncidentStatus.InReview, IncidentStatus.Closed], OccIncidentPolicy.NextStatuses(IncidentStatus.Resolved));
        Assert.Empty(OccIncidentPolicy.NextStatuses(IncidentStatus.Closed));
    }

    [Theory]
    [InlineData(GroundOperationStatus.PendingReview, IncidentStatus.Resolved, IncidentStatus.InReview, true)]
    [InlineData(GroundOperationStatus.Returned, IncidentStatus.Open, IncidentStatus.InReview, true)]
    [InlineData(GroundOperationStatus.Approved, IncidentStatus.Resolved, IncidentStatus.InReview, false)]
    [InlineData(GroundOperationStatus.Cancelled, IncidentStatus.Open, IncidentStatus.InReview, false)]
    [InlineData(GroundOperationStatus.Approved, IncidentStatus.Open, IncidentStatus.Resolved, true)]
    [InlineData(GroundOperationStatus.Cancelled, IncidentStatus.InReview, IncidentStatus.Resolved, true)]
    [InlineData(GroundOperationStatus.Approved, IncidentStatus.Resolved, IncidentStatus.Closed, true)]
    [InlineData(GroundOperationStatus.Approved, IncidentStatus.Open, IncidentStatus.Closed, false)]
    public void AnApprovedOrCancelledOperationOnlyResolvesOrClosesItsIncidents(GroundOperationStatus operation,
        IncidentStatus from, IncidentStatus to, bool allowed) =>
        Assert.Equal(allowed, OccIncidentPolicy.CanTransition(from, to, operation));

    [Fact]
    public void TheNextStatesOfAnApprovedOperationLeadToTheClose()
    {
        Assert.Equal([IncidentStatus.Closed],
            OccIncidentPolicy.NextStatuses(IncidentStatus.Resolved, GroundOperationStatus.Approved));
        Assert.Equal([IncidentStatus.Resolved],
            OccIncidentPolicy.NextStatuses(IncidentStatus.Open, GroundOperationStatus.Cancelled));
        Assert.Equal([IncidentStatus.InReview, IncidentStatus.Closed],
            OccIncidentPolicy.NextStatuses(IncidentStatus.Resolved, GroundOperationStatus.PendingReview));
    }

    [Theory]
    [InlineData("Open", IncidentStatus.Open)]
    [InlineData("Resolved", IncidentStatus.Resolved)]
    [InlineData("resolved", null)]
    [InlineData("2", null)]
    [InlineData(null, null)]
    public void OnlyTheExactStateNamesAreRead(string? value, IncidentStatus? expected) =>
        Assert.Equal(expected, OccIncidentPolicy.ParseStatus(value));

    [Fact]
    public void EveryChangeNeedsANoteOfEightToTwoThousandCharacters()
    {
        Assert.Equal("Revisado con la aerolínea", OccIncidentPolicy.Note("  Revisado con la aerolínea  "));
        Assert.Equal("Línea uno\nLínea dos", OccIncidentPolicy.Note("Línea uno\nLínea dos"));
        Assert.Null(OccIncidentPolicy.Note("corta"));
        Assert.Null(OccIncidentPolicy.Note(new string('x', 2001)));
        Assert.Null(OccIncidentPolicy.Note("Texto\0con control"));
        Assert.Null(OccIncidentPolicy.Note(null));
    }

    [Theory]
    [InlineData(GroundOperationStatus.Planned, true)]
    [InlineData(GroundOperationStatus.InProgress, true)]
    [InlineData(GroundOperationStatus.PendingReview, true)]
    [InlineData(GroundOperationStatus.Returned, true)]
    [InlineData(GroundOperationStatus.Approved, false)]
    [InlineData(GroundOperationStatus.Cancelled, false)]
    public void OccReportsOnAnOperationStillOpen(GroundOperationStatus status, bool allowed) =>
        Assert.Equal(allowed, OccIncidentPolicy.CanReport(status));

    [Fact]
    public void TheTimeIsNeitherInTheFutureNorBeforeTheOperation()
    {
        var now = new DateTimeOffset(2026, 11, 8, 15, 0, 0, TimeSpan.Zero);
        var opens = now.AddHours(-2);
        Assert.True(OccIncidentPolicy.IsValidOccurredAt(now.AddMinutes(-30), opens, now));
        Assert.True(OccIncidentPolicy.IsValidOccurredAt(now.AddMinutes(1), opens, now));
        Assert.True(OccIncidentPolicy.IsValidOccurredAt(opens.AddMinutes(-1), opens, now));
        Assert.False(OccIncidentPolicy.IsValidOccurredAt(now.AddMinutes(5), opens, now));
        Assert.False(OccIncidentPolicy.IsValidOccurredAt(opens.AddMinutes(-5), opens, now));
    }
}
