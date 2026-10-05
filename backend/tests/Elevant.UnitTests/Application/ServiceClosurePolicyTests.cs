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
}
