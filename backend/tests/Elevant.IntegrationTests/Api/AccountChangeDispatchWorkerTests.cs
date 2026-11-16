using Elevant.Api.Hubs;
using Elevant.Application.Abstractions.Realtime;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Elevant.IntegrationTests.Api;

public sealed class AccountChangeDispatchWorkerTests
{
    [Fact]
    public async Task PushFailureDoesNotUndoCommittedFeedBatch()
    {
        var store = new FakeStore();
        var push = new FailingPush();
        await using var provider = new ServiceCollection()
            .AddScoped<IAccountChangeDispatcherStore>(_ => store)
            .BuildServiceProvider();
        var worker = new AccountChangeDispatchWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            push, NullLogger<AccountChangeDispatchWorker>.Instance);

        var count = await worker.DispatchOnceAsync(10, TestContext.Current.CancellationToken);

        Assert.Equal(1, count);
        Assert.True(store.FeedCommitted);
        Assert.Equal(1, push.Attempts);
    }

    private sealed class FakeStore : IAccountChangeDispatcherStore
    {
        public bool FeedCommitted { get; private set; }

        public Task<IReadOnlyList<AccountChangeDispatchNotice>> DispatchPendingAsync(
            int limit, CancellationToken cancellationToken = default)
        {
            FeedCommitted = true;
            IReadOnlyList<AccountChangeDispatchNotice> notices =
            [
                new AccountChangeDispatchNotice(
                    Guid.Parse("40000000-0000-7000-8000-000000000001"),
                    Guid.NewGuid(), Guid.NewGuid(), "notifications", 42),
            ];
            return Task.FromResult(notices);
        }
    }

    private sealed class FailingPush : IAccountChangePush
    {
        public int Attempts { get; private set; }

        public Task SendAsync(AccountChangeDispatchNotice notice,
            CancellationToken cancellationToken = default)
        {
            Attempts++;
            throw new IOException("Simulated transport loss");
        }
    }
}
