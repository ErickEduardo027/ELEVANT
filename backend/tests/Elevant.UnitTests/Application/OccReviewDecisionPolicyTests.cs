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
}
