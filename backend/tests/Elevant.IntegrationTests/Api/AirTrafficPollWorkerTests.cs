using System.Collections.Concurrent;
using System.Threading.Channels;
using Elevant.Api.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// ADR-0042 (contracts 1.3): the air traffic worker returns at once where AirTraffic is off; otherwise it sleeps without
/// a timer until a screen reads the map, then reads at the pace <see cref="AirPictureService"/> answers for as long as the
/// demand lasts. It stops cleanly, and a pass that fails is logged once and waited out. The network is a stub: nothing
/// calls out.
/// </summary>
public sealed class AirTrafficPollWorkerTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 13, 15, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan Settle = TimeSpan.FromMilliseconds(200);
    private static readonly AirTrafficAttribution Credit = new("synthetic", "https://synthetic.example", "Test only", null);

    [Fact]
    public async Task ItReturnsAtOnceWithoutAProvider()
    {
        var ct = TestContext.Current.CancellationToken;
        var time = new ManualTime(Start);
        var network = new Network(time);
        foreach (var service in new[]
                 {
                     new AirPictureService(new UnconfiguredAirTrafficProvider(), AirTrafficSettings.Disabled, time),
                     new AirPictureService(new UnconfiguredAirTrafficProvider(), Settings(), time),
                     new AirPictureService(network, Settings() with { Enabled = false }, time),
                 })
        {
            var logger = new CapturedLog();
            using var worker = new AirTrafficPollWorker(service, time, logger);

            await worker.StartAsync(ct);
            await worker.ExecuteTask!.WaitAsync(Wait, ct);

            Assert.True(worker.ExecuteTask.IsCompletedSuccessfully);
            Assert.Equal([(6421, LogLevel.Information)], logger.Entries);
            // A screen that reads the map afterwards changes nothing.
            service.NoteDemand();
            await worker.StopAsync(ct);
        }
        Assert.Equal(0, time.TimersCreated);
        Assert.Equal(0, network.Reads);
    }

    [Fact]
    public async Task TheApiAlwaysRegistersItAndAirTrafficIsOffByDefault()
    {
        // No AirTraffic section (the Testing host, like appsettings.json): the worker is there and returns at once.
        await using var factory = new ElevantApiFactory();
        var services = factory.Services;

        Assert.Single(services.GetServices<IHostedService>().OfType<AirTrafficPollWorker>());
        var picture = services.GetRequiredService<AirPictureService>();
        Assert.False(picture.IsEnabled);
        Assert.Equal((AirPictureStatus.Disabled, AirPictureReasons.NotConfigured),
            (picture.Read(shortTrails: true).Status, picture.Read(shortTrails: true).Reason));
    }

    [Fact]
    public async Task ItWaitsForDemandThenPollsAtTheServiceDelay()
    {
        var ct = TestContext.Current.CancellationToken;
        var time = new ManualTime(Start);
        var network = new Network(time);
        var service = new AirPictureService(network, Settings(idleAfterSeconds: 120), time);
        var logger = new CapturedLog();
        using var worker = new AirTrafficPollWorker(service, time, logger);
        await worker.StartAsync(ct);

        // Nobody watches the map: no read and no timer, however long.
        time.Advance(TimeSpan.FromHours(1));
        await Task.Delay(Settle, ct);
        Assert.Equal((0, 0), (network.Reads, time.TimersCreated));

        // A screen reads the map at 16:00: the worker reads at once, then waits whatever the service answers.
        var watchedAt = time.GetUtcNow();
        service.NoteDemand();
        var reads = new List<DateTimeOffset> { await network.NextRead(ct) };
        var delays = new List<TimeSpan> { await time.NextTimer(ct) };
        async Task Next()
        {
            time.Advance(delays[^1]);
            reads.Add(await network.NextRead(ct));
            delays.Add(await time.NextTimer(ct));
        }
        await Next();
        // Two failures: the back-off of the service, not the interval.
        network.Outcome = AirTrafficOutcome.Failed;
        await Next();
        await Next();
        network.Outcome = AirTrafficOutcome.Succeeded;
        await Next();
        // The screen read nothing more: the reads go on until two minutes after its read, then stop.
        while (time.GetUtcNow() + delays[^1] < watchedAt.AddMinutes(2)) await Next();
        time.Advance(delays[^1]);
        await Task.Delay(Settle, ct);

        Assert.Equal([0, 10, 20, 35, 65, 75, 85, 95, 105, 115], reads.Select(read => (int)(read - watchedAt).TotalSeconds));
        Assert.Equal([10, 10, 15, 30, 10, 10, 10, 10, 10, 10], delays.Select(delay => (int)delay.TotalSeconds));
        Assert.Equal((10, 10), (network.Reads, time.TimersCreated));

        // The next screen wakes it again.
        service.NoteDemand();
        Assert.Equal(watchedAt.AddSeconds(125), await network.NextRead(ct));
        Assert.Equal(TimeSpan.FromSeconds(10), await time.NextTimer(ct));
        await worker.StopAsync(ct);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        // Refusals and failures of the network are states of the picture, not failures of the worker.
        Assert.Equal([(6424, LogLevel.Information), (6424, LogLevel.Information)], logger.Entries);
        Assert.Equal(0, time.PendingTimers);
    }

    [Fact]
    public async Task ItStopsCleanlyWhileWaitingForDemand()
    {
        var ct = TestContext.Current.CancellationToken;
        var time = new ManualTime(Start);
        var network = new Network(time);
        var service = new AirPictureService(network, Settings(), time);
        var logger = new CapturedLog();
        using var worker = new AirTrafficPollWorker(service, time, logger);

        await worker.StartAsync(ct);
        await Task.Delay(Settle, ct);
        await worker.StopAsync(ct);
        await worker.ExecuteTask!.WaitAsync(Wait, ct);

        Assert.True(worker.ExecuteTask.IsCompletedSuccessfully);
        Assert.Empty(logger.Entries);
        Assert.Equal((0, 0), (network.Reads, time.TimersCreated));
        // Demand after the stop wakes nobody.
        service.NoteDemand();
        await Task.Delay(Settle, ct);
        Assert.Equal(0, network.Reads);
    }

    [Fact]
    public async Task AFailedPassIsLoggedOnceAndWaitedOut()
    {
        var ct = TestContext.Current.CancellationToken;
        var time = new ManualTime(Start);
        var network = new Network(time);
        var service = new AirPictureService(network, Settings(), time);
        var logger = new CapturedLog();
        using var worker = new AirTrafficPollWorker(service, time, logger);
        await worker.StartAsync(ct);

        // The wait after the first read cannot be set up: the pass fails, and the worker waits a minute, not a loop.
        time.RefuseNextTimer();
        service.NoteDemand();
        Assert.Equal(Start, await network.NextRead(ct));
        Assert.Equal(AirTrafficPollWorker.FailureWait, await time.NextTimer(ct));
        await Task.Delay(Settle, ct);
        Assert.Equal(1, network.Reads);

        time.Advance(AirTrafficPollWorker.FailureWait);
        Assert.Equal(Start.AddMinutes(1), await network.NextRead(ct));
        Assert.Equal(TimeSpan.FromSeconds(10), await time.NextTimer(ct));
        await worker.StopAsync(ct);

        Assert.True(worker.ExecuteTask!.IsCompletedSuccessfully);
        Assert.Equal([(6424, LogLevel.Information), (6422, LogLevel.Error), (6423, LogLevel.Information)], logger.Entries);
        Assert.Equal("timer refused", Assert.Single(logger.Errors).Message);
    }

    private static AirTrafficSettings Settings(int idleAfterSeconds = 900) =>
        new(true, "PUJ", 18.5674, -68.3634, 250, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(idleAfterSeconds),
            TimeSpan.FromMinutes(180));

    /// <summary>A network that answers at once, without aircraft, and reports the clock of each read.</summary>
    private sealed class Network(TimeProvider time) : IAirTrafficProvider
    {
        private readonly Channel<DateTimeOffset> started = Channel.CreateUnbounded<DateTimeOffset>();
        private int reads;
        private int outcome = (int)AirTrafficOutcome.Succeeded;

        public AirTrafficOutcome Outcome
        {
            get => (AirTrafficOutcome)Volatile.Read(ref outcome);
            set => Volatile.Write(ref outcome, (int)value);
        }

        public int Reads => Volatile.Read(ref reads);

        public bool IsConfigured => true;

        public AirTrafficAttribution? Attribution => Credit;

        public Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref reads);
            var now = time.GetUtcNow();
            var answer = Outcome;
            started.Writer.TryWrite(now);
            return Task.FromResult(answer == AirTrafficOutcome.Succeeded
                ? new AirTrafficReadResult(answer, Credit, now, [], null)
                : AirTrafficReadResult.Failure(answer, Credit));
        }

        public async Task<DateTimeOffset> NextRead(CancellationToken cancellationToken) =>
            await started.Reader.ReadAsync(cancellationToken).AsTask().WaitAsync(Wait, cancellationToken);
    }

    /// <summary>
    /// A clock the test moves by hand. Its timers are one-shot (as <see cref="Task.Delay(TimeSpan, TimeProvider,
    /// CancellationToken)"/> creates them) and fire when the clock reaches their due time.
    /// </summary>
    private sealed class ManualTime(DateTimeOffset start) : TimeProvider
    {
        private readonly Lock gate = new();
        private readonly List<ManualTimer> pending = [];
        private readonly Channel<TimeSpan> created = Channel.CreateUnbounded<TimeSpan>();
        private DateTimeOffset now = start;
        private int timersCreated;
        private int refuseNext;

        public int TimersCreated => Volatile.Read(ref timersCreated);

        public int PendingTimers
        {
            get
            {
                lock (gate) return pending.Count;
            }
        }

        public override DateTimeOffset GetUtcNow()
        {
            lock (gate) return now;
        }

        /// <summary>The next timer the code asks for throws instead.</summary>
        public void RefuseNextTimer() => Volatile.Write(ref refuseNext, 1);

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            if (Interlocked.Exchange(ref refuseNext, 0) == 1) throw new InvalidOperationException("timer refused");
            var timer = new ManualTimer(this, callback, state);
            Schedule(timer, dueTime);
            Interlocked.Increment(ref timersCreated);
            created.Writer.TryWrite(dueTime);
            return timer;
        }

        /// <summary>The due time of the next timer the code creates.</summary>
        public async Task<TimeSpan> NextTimer(CancellationToken cancellationToken) =>
            await created.Reader.ReadAsync(cancellationToken).AsTask().WaitAsync(Wait, cancellationToken);

        /// <summary>Moves the clock and fires every timer that came due, outside the lock.</summary>
        public void Advance(TimeSpan by)
        {
            ManualTimer[] due;
            lock (gate)
            {
                now += by;
                due = [.. pending.Where(timer => timer.DueAt <= now)];
                foreach (var timer in due) pending.Remove(timer);
            }
            foreach (var timer in due) timer.Fire();
        }

        internal void Schedule(ManualTimer timer, TimeSpan dueTime)
        {
            lock (gate)
            {
                pending.Remove(timer);
                if (dueTime == Timeout.InfiniteTimeSpan) return;
                timer.DueAt = now + dueTime;
                pending.Add(timer);
            }
        }

        internal void Cancel(ManualTimer timer)
        {
            lock (gate) pending.Remove(timer);
        }
    }

    private sealed class ManualTimer(ManualTime time, TimerCallback callback, object? state) : ITimer
    {
        public DateTimeOffset DueAt { get; set; }

        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            time.Schedule(this, dueTime);
            return true;
        }

        public void Fire() => callback(state);

        public void Dispose() => time.Cancel(this);

        public ValueTask DisposeAsync()
        {
            Dispose();
            return ValueTask.CompletedTask;
        }
    }

    private sealed class CapturedLog : ILogger<AirTrafficPollWorker>
    {
        private readonly ConcurrentQueue<(int EventId, LogLevel Level)> entries = new();
        private readonly ConcurrentQueue<Exception> errors = new();

        public IReadOnlyList<(int EventId, LogLevel Level)> Entries => [.. entries];

        public IReadOnlyList<Exception> Errors => [.. errors];

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            entries.Enqueue((eventId.Id, logLevel));
            if (exception is not null) errors.Enqueue(exception);
        }
    }
}
