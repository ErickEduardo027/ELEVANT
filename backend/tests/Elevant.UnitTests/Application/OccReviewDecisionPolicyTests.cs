using Elevant.Application.Operations;

namespace Elevant.UnitTests.Application;

public sealed class OccReviewDecisionPolicyTests
{
    [Theory]
    [InlineData("Approved", null, true)]
    [InlineData("Approved", "", true)]
    [InlineData("Approved", "Unwanted reason", false)]
    [InlineData("Returned", "Revisar el servicio", true)]
    [InlineData("Returned", "Falta", false)]
    [InlineData("Returned", null, false)]
    [InlineData("Unknown", "Revisar el servicio", false)]
    public void RequiresExactOutcomeAndReason(string outcome, string? reason, bool expected)
    {
        Assert.Equal(expected, OccReviewDecisionPolicy.HasValidRequest(outcome, reason));
    }

    [Fact]
    public void RejectsControlCharactersAndExcessiveReason()
    {
        Assert.False(OccReviewDecisionPolicy.HasValidRequest("Returned", "Texto\0inyectado"));
        Assert.False(OccReviewDecisionPolicy.HasValidRequest("Returned", new string('x', 2001)));
        Assert.True(OccReviewDecisionPolicy.HasValidRequest("Returned", "Línea uno\nLínea dos"));
    }

    [Fact]
    public void OnlyPendingSubmissionCanBeDecided()
    {
        Assert.True(OccReviewDecisionPolicy.CanDecide("PendingReview", "PendingReview"));
        Assert.False(OccReviewDecisionPolicy.CanDecide("InProgress", "PendingReview"));
        Assert.False(OccReviewDecisionPolicy.CanDecide("PendingReview", "Approved"));
    }

    /// <summary>3-H: only an approved operation with its approved hand-off is reopened.</summary>
    [Theory]
    [InlineData("Approved", "Approved", true)]
    [InlineData("PendingReview", "PendingReview", false)]
    [InlineData("Approved", "PendingReview", false)]
    [InlineData("Returned", "Returned", false)]
    [InlineData("Cancelled", "Approved", false)]
    public void OnlyAnApprovalIsReopened(string operationStatus, string submissionStatus, bool expected) =>
        Assert.Equal(expected, OccReviewDecisionPolicy.CanReopen(operationStatus, submissionStatus));

    /// <summary>3-H: a reopened revision is approved again in OCC: its agent and stand are already free.</summary>
    [Fact]
    public void AReopenedRevisionIsNeverReturnedToTheRamp()
    {
        Assert.True(OccReviewDecisionPolicy.CanReturn(isReopened: false));
        Assert.False(OccReviewDecisionPolicy.CanReturn(isReopened: true));
    }

    [Fact]
    public void AReopeningNeedsAMeaningfulReason()
    {
        Assert.Equal("La aerolínea pidió revisar", OccReviewDecisionPolicy.ReopenReason("  La aerolínea pidió revisar "));
        Assert.Null(OccReviewDecisionPolicy.ReopenReason("corta"));
        Assert.Null(OccReviewDecisionPolicy.ReopenReason(null));
        Assert.Null(OccReviewDecisionPolicy.ReopenReason("Texto\0con control"));
        Assert.Null(OccReviewDecisionPolicy.ReopenReason(new string('x', 2001)));
    }
}
