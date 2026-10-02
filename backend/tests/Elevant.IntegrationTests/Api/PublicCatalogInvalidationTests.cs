using Elevant.Api.Hubs;
using Microsoft.Extensions.Logging.Abstractions;

namespace Elevant.IntegrationTests.Api;

public sealed class PublicCatalogInvalidationTests
{
    [Fact]
    public async Task FailedBroadcastDoesNotTurnPersistedCatalogChangeIntoAnError()
    {
        var sends = 0;

        await PublicCatalogInvalidation.TrySendAsync(_ =>
        {
            sends++;
            throw new InvalidOperationException("Push channel unavailable.");
        }, NullLogger.Instance);

        Assert.Equal(1, sends);
    }

    [Fact]
    public async Task SuccessfulBroadcastIsSentOnce()
    {
        var sends = 0;

        await PublicCatalogInvalidation.TrySendAsync(_ =>
        {
            sends++;
            return Task.CompletedTask;
        }, NullLogger.Instance);

        Assert.Equal(1, sends);
    }
}
