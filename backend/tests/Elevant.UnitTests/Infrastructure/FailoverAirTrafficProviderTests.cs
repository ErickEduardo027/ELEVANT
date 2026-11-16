using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;
using Elevant.Infrastructure.Integrations.AirTraffic;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// ADR-0042 (contracts 1.3): <c>AirTraffic:Providers</c> is an ordered list. Each read is answered by the active network;
/// the next one takes over after three failures in a row of the active one. Every ten minutes (or after its
/// <c>Retry-After</c>) the first is asked again before the active one: it becomes active again when it answers, and when it
/// does not the active one answers the same read, so the caller never sees the failed retry. A network that answered 429
/// is not asked before its <c>Retry-After</c> ends, at least a minute later, not even by a hand-over: the active one keeps
/// the turn meanwhile. The credit follows the active network.
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
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);

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

        // Any outcome but a success counts. After three failures of the last network the first takes over again, once the
        // minute a 429 waits at least is over.
        clock.Advance(AirTrafficBackOff.MinimumRateLimitWait);
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

        // Ten minutes after the hand-over the first one is asked before the second. It still refuses, so the second
        // answers that same read and stays active: the caller gets the second's answer, never the refusal, and the next
        // retry comes ten minutes after this one.
        clock.Advance(TimeSpan.FromSeconds(1));
        var retry = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Succeeded, Second), (retry.Outcome, retry.Source));
        Assert.Equal((4, 2), (first.Reads, second.Reads));
        Assert.Equal(Second, failover.Attribution);
        clock.Advance(TimeSpan.FromMinutes(10) - TimeSpan.FromSeconds(1));
        await Read(failover);
        Assert.Equal((4, 3), (first.Reads, second.Reads));

        // The next retry finds it answering: its answer is the read's, without asking the second, and it is active again
        // for good.
        clock.Advance(TimeSpan.FromSeconds(1));
        first.Outcome = AirTrafficOutcome.Succeeded;
        var back = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Succeeded, First), (back.Outcome, back.Source));
        Assert.Equal((5, 3), (first.Reads, second.Reads));
        Assert.Equal(First, failover.Attribution);
        clock.Advance(TimeSpan.FromMinutes(30));
        await Read(failover);
        await Read(failover);
        Assert.Equal((7, 3), (first.Reads, second.Reads));
    }

    [Fact]
    public async Task AFailedRetryOfTheFirstNeverReachesTheCaller()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        for (var read = 0; read < 3; read++) await Read(failover);

        // Whatever the first answers a retry with, the second answers the same call: the caller gets the second's read,
        // without the first's outcome or its Retry-After (shorter than ten minutes here, so the retries stay ten apart).
        var refusals = new (AirTrafficOutcome Outcome, TimeSpan? RetryAfter)[]
        {
            (AirTrafficOutcome.RateLimited, TimeSpan.FromMinutes(5)), (AirTrafficOutcome.Unauthorized, null),
            (AirTrafficOutcome.QuotaExceeded, null), (AirTrafficOutcome.Failed, null),
        };
        foreach (var (outcome, retryAfter) in refusals)
        {
            (first.Outcome, first.RetryAfter) = (outcome, retryAfter);
            clock.Advance(FailoverAirTrafficProvider.FirstProviderRetry);
            var (firstReads, secondReads) = (first.Reads, second.Reads);
            var read = await Read(failover);
            Assert.Equal((AirTrafficOutcome.Succeeded, Second, (TimeSpan?)null), (read.Outcome, read.Source, read.RetryAfter));
            Assert.Equal((firstReads + 1, secondReads + 1), (first.Reads, second.Reads));
            Assert.Equal(Second, failover.Attribution);
        }

        // When the second fails too, the caller gets the second's failure, never the first's.
        (first.Outcome, first.RetryAfter) = (AirTrafficOutcome.RateLimited, TimeSpan.FromMinutes(1));
        (second.Outcome, second.RetryAfter) = (AirTrafficOutcome.RateLimited, TimeSpan.FromSeconds(30));
        clock.Advance(FailoverAirTrafficProvider.FirstProviderRetry);
        var both = await Read(failover);
        Assert.Equal((AirTrafficOutcome.RateLimited, Second, (TimeSpan?)TimeSpan.FromSeconds(30)),
            (both.Outcome, both.Source, both.RetryAfter));
    }

    [Fact]
    public async Task AFailedRetryOfTheFirstLeavesTheActiveCountAsItWas()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second) { Outcome = AirTrafficOutcome.Failed };
        using var failover = new FailoverAirTrafficProvider([first, second], clock);
        for (var read = 0; read < 3; read++) await Read(failover);

        // One failure of the second before the retry and one in the call of the retry: two in a row, so the second stays
        // active. The first's failure is not one of them, and the caller gets the second's.
        clock.Advance(TimeSpan.FromMinutes(9));
        await Read(failover);
        clock.Advance(TimeSpan.FromMinutes(1));
        var retry = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Failed, Second), (retry.Outcome, retry.Source));
        Assert.Equal((4, 2), (first.Reads, second.Reads));
        Assert.Equal(Second, failover.Attribution);

        // Nor did the retry start the count again: the next failure is the third in a row and the list wraps around.
        Assert.Equal(Second, (await Read(failover)).Source);
        Assert.Equal((4, 3), (first.Reads, second.Reads));
        Assert.Equal(First, failover.Attribution);
    }

    [Fact]
    public async Task TheFirstIsNotAskedAgainBeforeItsRetryAfter()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.RateLimited, RetryAfter = TimeSpan.FromMinutes(25) };
        var second = new ScriptedProvider(Second);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);

        // Reads once a minute, every one answered by the second network, until the first is asked again.
        async Task<TimeSpan> UntilTheFirstIsAskedAgain()
        {
            var reads = first.Reads;
            for (var minute = 1; minute <= 2 * 24 * 60; minute++)
            {
                clock.Advance(TimeSpan.FromMinutes(1));
                var read = await Read(failover);
                Assert.Equal((AirTrafficOutcome.Succeeded, Second), (read.Outcome, read.Source));
                if (first.Reads > reads) return TimeSpan.FromMinutes(minute);
            }
            return Timeout.InfiniteTimeSpan;
        }

        // Its third request to slow down hands over. It asked for 25 minutes, so the first retry comes then, not at ten;
        // that retry asks for an hour.
        for (var read = 0; read < 3; read++) await Read(failover);
        Assert.Equal(Second, failover.Attribution);
        first.RetryAfter = TimeSpan.FromHours(1);
        Assert.Equal(TimeSpan.FromMinutes(25), await UntilTheFirstIsAskedAgain());

        // The next retry comes an hour later and asks for two minutes: shorter than ten, so the one after keeps the ten.
        first.RetryAfter = TimeSpan.FromMinutes(2);
        Assert.Equal(TimeSpan.FromHours(1), await UntilTheFirstIsAskedAgain());
        first.RetryAfter = TimeSpan.FromDays(365);
        Assert.Equal(TimeSpan.FromMinutes(10), await UntilTheFirstIsAskedAgain());

        // That one asked for a year: the next retry waits a day, the longest wait of all.
        Assert.Equal(TimeSpan.FromDays(1), await UntilTheFirstIsAskedAgain());
        Assert.Equal(Second, failover.Attribution);
    }

    [Fact]
    public async Task NoNetworkTakesTheTurnBeforeItsRetryAfter()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second) { Outcome = AirTrafficOutcome.Failed };
        using var failover = new FailoverAirTrafficProvider([first, second], clock);

        // The first fails three times and hands over. The second fails twice, and its third failure is a 429 that asks for
        // half an hour: it hands back to the first.
        for (var read = 0; read < 5; read++) await Read(failover);
        (second.Outcome, second.RetryAfter) = (AirTrafficOutcome.RateLimited, TimeSpan.FromMinutes(30));
        var limited = await Read(failover);
        Assert.Equal((AirTrafficOutcome.RateLimited, Second), (limited.Outcome, limited.Source));
        Assert.Equal(First, failover.Attribution);
        Assert.Equal((3, 3), (first.Reads, second.Reads));

        // The first keeps failing, once a minute. Its third failure would hand over, but the second is still waiting: the
        // first keeps the turn and answers every read, and the second is not asked during its half hour.
        for (var minute = 1; minute < 30; minute++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            Assert.Equal(First, (await Read(failover)).Source);
            Assert.Equal(First, failover.Attribution);
        }
        Assert.Equal((32, 3), (first.Reads, second.Reads));

        // Once the half hour is over, the next failure of the first hands over at once, and the second answers.
        clock.Advance(TimeSpan.FromMinutes(1));
        second.Outcome = AirTrafficOutcome.Succeeded;
        Assert.Equal(First, (await Read(failover)).Source);
        Assert.Equal(Second, failover.Attribution);
        var answered = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Succeeded, Second), (answered.Outcome, answered.Source));
        Assert.Equal((33, 4), (first.Reads, second.Reads));

        // The other way round: ten minutes after that hand-over the retry finds the first asking for half an hour.
        clock.Advance(FailoverAirTrafficProvider.FirstProviderRetry);
        (first.Outcome, first.RetryAfter) = (AirTrafficOutcome.RateLimited, TimeSpan.FromMinutes(30));
        Assert.Equal(Second, (await Read(failover)).Source);
        Assert.Equal((34, 5), (first.Reads, second.Reads));

        // Then the second fails, once a minute. After its third failure it keeps the turn, because the first is waiting,
        // and the first is asked again only when its half hour is over: by the retry, which finds it answering.
        second.Outcome = AirTrafficOutcome.Failed;
        for (var minute = 1; minute < 30; minute++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            Assert.Equal(Second, (await Read(failover)).Source);
            Assert.Equal(Second, failover.Attribution);
        }
        Assert.Equal((34, 34), (first.Reads, second.Reads));
        clock.Advance(TimeSpan.FromMinutes(1));
        first.Outcome = AirTrafficOutcome.Succeeded;
        var back = await Read(failover);
        Assert.Equal((AirTrafficOutcome.Succeeded, First), (back.Outcome, back.Source));
        Assert.Equal((35, 34), (first.Reads, second.Reads));
        Assert.Equal(First, failover.Attribution);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(5)]
    public async Task ARequestToSlowDownKeepsTheTurnAwayForAtLeastAMinute(int? retryAfterSeconds)
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First)
        {
            Outcome = AirTrafficOutcome.RateLimited,
            RetryAfter = retryAfterSeconds is { } seconds ? TimeSpan.FromSeconds(seconds) : null,
        };
        var second = new ScriptedProvider(Second) { Outcome = AirTrafficOutcome.Failed };
        using var failover = new FailoverAirTrafficProvider([first, second], clock);

        // Three 429s of the first, without a Retry-After or with a shorter one than a minute, hand over to the second.
        for (var read = 0; read < 3; read++) await Read(failover);
        Assert.Equal(Second, failover.Attribution);

        // The second fails three times within that minute: the first does not take the turn back yet.
        for (var read = 0; read < 3; read++)
        {
            clock.Advance(TimeSpan.FromSeconds(15));
            Assert.Equal(Second, (await Read(failover)).Source);
        }
        Assert.Equal(Second, failover.Attribution);

        // A minute after its 429 the next failure of the second hands over to it.
        clock.Advance(TimeSpan.FromSeconds(15));
        Assert.Equal(Second, (await Read(failover)).Source);
        Assert.Equal(First, failover.Attribution);
        Assert.Equal((3, 4), (first.Reads, second.Reads));
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
    public async Task AsksEachProviderAtMostOncePerCall()
    {
        var clock = new ManualClock(Start);
        var first = new ScriptedProvider(First) { Outcome = AirTrafficOutcome.Failed };
        var second = new ScriptedProvider(Second);
        using var failover = new FailoverAirTrafficProvider([first, second], clock);

        // A call asks one network. Only a retry of the first that fails asks the active one too, in the same call: with
        // the first failing for forty minutes, one call every ten minutes after the hand-over.
        var callsWithTwoReads = new List<int>();
        for (var minute = 1; minute <= 40; minute++)
        {
            clock.Advance(TimeSpan.FromMinutes(1));
            var (firstBefore, secondBefore) = (first.Reads, second.Reads);
            await Read(failover);
            var (firstAsked, secondAsked) = (first.Reads - firstBefore, second.Reads - secondBefore);
            Assert.InRange(firstAsked, 0, 1);
            Assert.InRange(secondAsked, 0, 1);
            Assert.InRange(firstAsked + secondAsked, 1, 2);
            if (firstAsked + secondAsked == 2) callsWithTwoReads.Add(minute);
        }
        Assert.Equal([13, 23, 33], callsWithTwoReads);
        Assert.Equal((6, 37), (first.Reads, second.Reads));

        // Calls at the same time share one retry: while the first is being asked, the others ask the second only, and the
        // call that asked the first gets the second's read once the first fails.
        clock.Advance(FailoverAirTrafficProvider.FirstProviderRetry);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        first.Gate = gate;
        var calls = Enumerable.Range(0, 20).Select(_ => failover.ReadAsync(Area, TestContext.Current.CancellationToken)).ToArray();
        Assert.Equal((7, 56), (first.Reads, second.Reads));
        gate.SetResult();
        var results = await Task.WhenAll(calls);
        Assert.Equal((7, 57), (first.Reads, second.Reads));
        Assert.All(results, result => Assert.Equal((AirTrafficOutcome.Succeeded, Second), (result.Outcome, result.Source)));
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

        /// <summary>What a failed read asks to wait, as a network's <c>Retry-After</c> would.</summary>
        public TimeSpan? RetryAfter { get; set; }

        /// <summary>When set, every read waits for it.</summary>
        public TaskCompletionSource? Gate { get; set; }

        public int Reads => Volatile.Read(ref _reads);

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution => attribution;

        public async Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _reads);
            if (Gate is { } gate) await gate.Task.WaitAsync(cancellationToken);
            return Outcome == AirTrafficOutcome.Succeeded
                ? new AirTrafficReadResult(Outcome, attribution, Start, [], null)
                : AirTrafficReadResult.Failure(Outcome, attribution, RetryAfter);
        }
    }

    private sealed class ManualClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan amount) => _now += amount;
    }
}
