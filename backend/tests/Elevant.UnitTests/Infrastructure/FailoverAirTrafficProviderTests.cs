using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Integrations.AirTraffic;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0042 (contracts 1.3): <c>AirTraffic:Providers</c> is an ordered list. Each read asks one network; the next one
/// takes over after three failures in a row of the active one, the first is asked again every ten minutes and becomes
/// active again when it answers, and the credit follows the active network.
/// </summary>
public sealed class FailoverAirTrafficProviderTests
{
    private static readonly AirTrafficArea Area = new(18.5674, -68.3634, 250);
    private static readonly AirTrafficAttribution First = new("first", "https://first.example", "Licence one", null);
    private static readonly AirTrafficAttribution Second = new("second", "https://second.example", "Licence two", null);
    private static readonly DateTimeOffset Start = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task MovesToTheNextProviderAfterThreeFailures()
    {
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second);
        using var failover = new FailoverAirTrafficProvider([first, second], new ManualClock(Start));

        // Two failures, a success and two more failures: a success starts the count again.
        await Read(failover);
        await Read(failover);
        first.Outcome = AirTrafficOutcome.Succeeded;
        await Read(failover);
        first.Outcome = AirTrafficOutcome.RateLimited;
        await Read(failover);
        await Read(failover);
        Assert.Equal((5, 0), (first.Reads, second.Reads));

        // The third failure in a row is still the first one's answer; the next read goes to the second network.
        var third = await Read(failover);
        Assert.Equal((AirTrafficOutcome.RateLimited, First), (third.Outcome, third.Source));
        var next = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Succeeded, Second), (next.Outcome, next.Source));
        Assert.Equal((6, 1), (first.Reads, second.Reads));

        // Any outcome but a success counts. After three failures of the last network the first takes over again.
        foreach (var outcome in new[] { AirTrafficOutcome.Unauthorized, AirTrafficOutcome.QuotaExceeded, AirTrafficOutcome.Failed })
        {
            second.Outcome = outcome;
            Assert.Equal(Second, (await Read(failover)).Source);
        }
        first.Outcome = AirTrafficOutcome.Succeeded;
        Assert.Equal(First, (await Read(failover)).Source);
        Assert.Equal((7, 4), (first.Reads, second.Reads));
    }

    [Fact]
    public async Task RetriesTheFirstEveryTenMinutesAndReturnsToIt()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Unauthorized };
        var second = new ScriptedProvider(Second);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        for (var read = 0; read < 3; read++) await Read(failover);

        // Until ten minutes have passed every read goes to the second network.
        clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromSeconds(1));
        await Read(failover);
        Assert.Equal((3, 1), (first.Reads, second.Reads));

        // Ten minutes after the hand-over the first one is asked instead; it still refuses, so the second stays active and
        // the next retry comes ten minutes after this one.
        clock.Advance(TimeSpan.FromSeconds(1));
        var retry = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Unauthorized, First), (retry.Outcome, retry.Source));
        Assert.Equal(Second, failover.Attribution);
        clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromSeconds(1));
        await Read(failover);
        Assert.Equal((4, 2), (first.Reads, second.Reads));

        // The next retry finds it answering: it is active again, for good.
        clock.Advance(TimeSpan.FromSeconds(1));
        first.Outcome = AirTrafficOutcome.Succeeded;
        var back = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Succeeded, First), (back.Outcome, back.Source));
        Assert.Equal(First, failover.Attribution);
        clock.Advance(TimeSpan.FromMinutes(30));
        await Read(failover);
        await Read(failover);
        Assert.Equal((7, 2), (first.Reads, second.Reads));
    }

    [Fact]
    public async Task AFailedRetryOfTheFirstLeavesTheActiveCountAsItWas()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second) { Outcome = AirTrafficOutcome.Failed };
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        for (var read = 0; read < 3; read++) await Read(failover);

        clock.Advance(TimeSpan.FromMinutes(9));
        await Read(failover);
        await Read(failover);
        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.Equal(First, (await Read(failover)).Source);
        Assert.Equal(Second, failover.Attribution);

        // The second network's two failures before the retry and this one are three in a row: the list wraps around.
        Assert.Equal(Second, (await Read(failover)).Source);
        Assert.Equal((4, 3), (first.Reads, second.Reads));
        Assert.Equal(First, failover.Attribution);
    }

    [Fact]
    public async Task TheAttributionFollowsTheActiveProvider()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        Assert.True(failover.IsConfigured);
        Assert.Equal(First, failover.Attribution);

        for (var read = 0; read < 3; read++) await Read(failover);
        Assert.Equal(Second, failover.Attribution);

        clock.Advance(FailoverAirTrafficProvider.FirstProviderRetry);
        first.Outcome = AirTrafficOutcome.Succeeded;
        await Read(failover);
        Assert.Equal(First, failover.Attribution);

        // A list of one network keeps it, however often it fails.
        var only = new ScriptedProvider(Second) { Outcome = AirTrafficOutcome.Failed };
        using var single = new FailoverAirTrafficProvider([only], clock);
        for (var read = 0; read < 10; read++) await Read(single);
        Assert.Equal((Second, 10), (single.Attribution, only.Reads));
    }

    [Fact]
    public async Task MakesOneProviderReadPerCall()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second) { Outcome = AirTrafficOutcome.Failed };
        using var failover = new FailoverAirTrafficProvider([first, second], clock);

        // Failures, hand-overs and retries of the first: never a second read in the same call.
        for (var call = 1; call <= 40; call++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            await Read(failover);
            Assert.Equal(call, first.Reads + second.Reads);
        }
        Assert.True(first.Reads > 0 && second.Reads > 0);

        // Calls at the same time each ask once too.
        await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => failover.ReadAsync(Area, TestContext.Current.CancellationToken)));
        Assert.Equal(60, first.Reads + second.Reads);
    }

    [Fact]
    public void NeedsAtLeastOneConfiguredNetwork()
    {
        Assert.Throws<ArgumentException>(() => new FailoverAirTrafficProvider([], TimeProvider.System));
        Assert.Throws<ArgumentException>(() =>
            new FailoverAirTrafficProvider([new ScriptedProvider(First), new UnconfiguredAirTrafficProvider()], TimeProvider.System));
    }

    private static Task<AirTrafficReadResult> Read(FailoverAirTrafficProvider failover) =>
        failover.ReadAsync(Area, TestContext.Current.CancellationToken);

    private sealed class ScriptedProvider(AirTrafficAttribution attribution) : IAirTrafficProvider
    {
        private int _reads;

        public AirTrafficOutcome Outcome { get; set; } = AirTrafficOutcome.Succeeded;

        public int Reads => Volatile.Read(ref _reads);

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution => attribution;

        public Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _reads);
            return Task.FromResult(Outcome == AirTrafficOutcome.Succeeded
                ? new AirTrafficReadResult(Outcome, attribution, Start, [], null)
                : AirTrafficReadResult.Failure(Outcome, attribution));
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan amount) => _now += amount;
    }
}
