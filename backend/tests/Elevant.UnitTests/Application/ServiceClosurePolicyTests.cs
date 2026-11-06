using Elevant.Application.Commercial;

namespace Elevant.UnitTests.Application;

public sealed class ServiceClosurePolicyTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("         ")]
    [InlineData("demasiado")]
    public void AClosureReasonMustExplainTheAction(string? reason)
    {
        Assert.False(ServiceClosurePolicy.TryNormalizeReason(reason, out _));
    }

    [Fact]
    public void AValidReasonIsTrimmedAndBounded()
    {
        Assert.True(ServiceClosurePolicy.TryNormalizeReason("  No hay equipos disponibles  ", out var reason));
        Assert.Equal("No hay equipos disponibles", reason);
        Assert.False(ServiceClosurePolicy.TryNormalizeReason(new string('x', 1001), out _));
    }

    [Fact]
    public void TheRequesterCannotDecideTheirOwnClosure()
    {
        var requester = Guid.NewGuid();
        Assert.False(ServiceClosurePolicy.CanDecide(requester, requester));
        Assert.True(ServiceClosurePolicy.CanDecide(requester, Guid.NewGuid()));
    }

    [Fact]
    public void OccReportsOnlyAPublishedServiceOnce()
    {
        Assert.Equal("service_not_published", ServiceClosurePolicy.RequestIssue(true, false, false));
        Assert.Equal("service_not_published", ServiceClosurePolicy.RequestIssue(false, true, false));
        Assert.Equal("closure_pending", ServiceClosurePolicy.RequestIssue(true, true, true));
        Assert.Null(ServiceClosurePolicy.RequestIssue(true, true, false));
    }

    [Fact]
    public void ARetiredServiceIsReactivatedBeforeItIsRepublished()
    {
        Assert.Equal("service_retired", ServiceClosurePolicy.ReopenIssue(false, false, false, true));
        Assert.Equal("service_already_public", ServiceClosurePolicy.ReopenIssue(true, true, false, true));
        Assert.Equal("closure_pending", ServiceClosurePolicy.ReopenIssue(true, false, true, true));
        Assert.Equal("no_approved_closure", ServiceClosurePolicy.ReopenIssue(true, false, false, false));
        Assert.Null(ServiceClosurePolicy.ReopenIssue(true, false, false, true));
    }
}
