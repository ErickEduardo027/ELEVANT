using System.Collections.Concurrent;
using System.Threading.Channels;
using Elevant.Api.Integration;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration.DemoFlights;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// ADR-0041: the progress worker reads the demo clock every five seconds only where demo flights are on. A failed pass
/// (no database, as when the API image is certified) is retried by the next tick and logged once per streak, so the
/// host neither stops nor floods its log.
/// </summary>
public sealed class DemoFlightProgressWorkerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 12, 14, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(10);

    [Fact]
    public async Task ItDoesNothingWhereDemoFlightsAreOff()
    {
        var store = new Store();
        var time = new ManualTime(Now);
        var logger = new CapturedLog();
        using var worker = Worker(store, DemoFlightAvailability.Disabled, time, logger);

        await worker.StartAsync(TestContext.Current.CancellationToken);
        await worker.ExecuteTask!.WaitAsync(Wait, TestContext.Current.CancellationToken);

        Assert.True(worker.ExecuteTask.IsCompletedSuccessfully);
        Assert.Equal(0, time.Timers);
        Assert.Equal(0, store.Calls);
        Assert.Equal([(6411, LogLevel.Information)], logger.Entries);
        await worker.StopAsync(TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task ItAdvancesAtStartAndOnEveryTickWithTheServerClock()
    {
        var store = new Store();
        var time = new ManualTime(Now);
        var logger = new CapturedLog();
        using var worker = Worker(store, DemoFlightAvailability.On, time, logger);
        var ct = TestContext.Current.CancellationToken;

        await worker.StartAsync(ct);
        Assert.Equal(Now, await store.Started.Reader.ReadAsync(ct).AsTask().WaitAsync(Wait, ct));
        Assert.Equal(TimeSpan.FromSeconds(5), time.Period);
        time.Advance(TimeSpan.FromSeconds(5));
        Assert.Equal(Now.AddSeconds(5), await store.Started.Reader.ReadAsync(ct).AsTask().WaitAsync(Wait, ct));
        time.Advance(TimeSpan.FromSeconds(5));
        Assert.Equal(Now.AddSeconds(10), await store.Started.Reader.ReadAsync(ct).AsTask().WaitAsync(Wait, ct));
        await worker.StopAsync(ct);

        Assert.Equal(3, store.Calls);
        // Nothing changed in these passes, so nothing is logged.
        Assert.Empty(logger.Entries);
    }

    [Fact]
    public async Task AFailureStreakIsLoggedOnceAndItsRecoveryOnce()
    {
        // No database twice, then a pass that advances a flight, then another failure.
        var store = new Store(new InvalidOperationException("no database"), new TimeoutException("no database"), 1,
            new InvalidOperationException("deadlock"), 0);
        var time = new ManualTime(Now);
        var logger = new CapturedLog();
        using var worker = Worker(store, DemoFlightAvailability.On, time, logger);
        var ct = TestContext.Current.CancellationToken;

        await worker.StartAsync(ct);
        for (var pass = 0; pass < 5; pass++)
        {
            if (pass > 0) time.Advance(TimeSpan.FromSeconds(5));
            await store.Started.Reader.ReadAsync(ct).AsTask().WaitAsync(Wait, ct);
        }
        await worker.StopAsync(ct);

        // The worker survived every failure and ran every tick; only the stop ended it.
        Assert.Equal(5, store.Calls);
        Assert.False(worker.ExecuteTask!.IsFaulted);
        Assert.Equal([(6412, LogLevel.Error), (6413, LogLevel.Information), (6414, LogLevel.Information),
            (6412, LogLevel.Error), (6413, LogLevel.Information)], logger.Entries);
        Assert.Equal(["no database", "deadlock"], logger.Errors.Select(error => error.Message));
    }

    private static DemoFlightProgressWorker Worker(Store store, DemoFlightAvailability availability, TimeProvider time,
        ILogger<DemoFlightProgressWorker> logger)
    {
        var services = new ServiceCollection().AddScoped<IDemoFlightStore>(_ => store).BuildServiceProvider();
        return new DemoFlightProgressWorker(services.GetRequiredService<IServiceScopeFactory>(), availability, time, logger);
    }

    /// <summary>
    /// Answers each pass with the next outcome (an exception is thrown, a number is the flights advanced; 0 once they
    /// run out) and reports the clock each pass read.
    /// </summary>
    private sealed class Store(params object[] outcomes) : IDemoFlightStore
    {
        private readonly ConcurrentQueue<object> pending = new(outcomes);
        private int calls;

        public Channel<DateTimeOffset> Started { get; } = Channel.CreateUnbounded<DateTimeOffset>();

        public int Calls => Volatile.Read(ref calls);

        public Task<int> AdvanceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref calls);
            var outcome = pending.TryDequeue(out var next) ? next : 0;
            // Reported last: the worker has left the previous pass when the test sees this one.
            Started.Writer.TryWrite(now);
            return outcome is Exception failure ? Task.FromException<int>(failure) : Task.FromResult((int)outcome);
        }

        public Task<DemoFlightOptionsData?> OptionsAsync(Guid actorId, DemoFlightOptionsQuery query,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<DemoFlightListData?> ListAsync(Guid actorId, Guid? stationId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<MasterDataResult<DemoFlightData>> CreateAsync(Guid actorId, CreateDemoFlightInput input,
            Guid idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<MasterDataResult<DemoFlightData>> CancelAsync(Guid actorId, Guid demoFlightId, DemoFlightIntent intent,
            Guid idempotencyKey, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    /// <summary>A clock the test moves by hand; its timers fire only when the test advances it.</summary>
    private sealed class ManualTime(DateTimeOffset start) : TimeProvider
    {
        private readonly object gate = new();
        private readonly List<ManualTimer> timers = [];
        private DateTimeOffset now = start;

        public int Timers
        {
            get { lock (gate) return timers.Count; }
        }

        public TimeSpan? Period
        {
            get { lock (gate) return timers.Count == 0 ? null : timers[^1].Period; }
        }

        public override DateTimeOffset GetUtcNow()
        {
            lock (gate) return now;
        }

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new ManualTimer(callback, state, period);
            lock (gate) timers.Add(timer);
            return timer;
        }

        /// <summary>Moves the clock and fires every timer once.</summary>
        public void Advance(TimeSpan by)
        {
            ManualTimer[] due;
            lock (gate)
            {
                now += by;
                due = [.. timers];
            }
            foreach (var timer in due) timer.Fire();
        }
    }

    private sealed class ManualTimer(TimerCallback callback, object? state, TimeSpan period) : ITimer
    {
        private bool disposed;

        public TimeSpan Period { get; private set; } = period;

        public bool Change(TimeSpan dueTime, TimeSpan period)
        {
            Period = period;
            return !disposed;
        }

        public void Fire()
        {
            if (!disposed) callback(state);
        }

        public void Dispose() => disposed = true;

        public ValueTask DisposeAsync()
        {
            disposed = true;
            return ValueTask.CompletedTask;
        }
    }

    private sealed class CapturedLog : ILogger<DemoFlightProgressWorker>
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
