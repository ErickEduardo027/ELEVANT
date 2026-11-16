using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

/// <summary>ADR-0028: every provider call goes through the lease, the budget and the pause.</summary>
public sealed class FlightFeedSynchronizerTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 3, 14, 0, 0, TimeSpan.Zero); // 10:00 at PUJ
    private static readonly FlightFeedStation Puj = new(1, Guid.NewGuid(), "PUJ", "PUJ", "America/Santo_Domingo");

    [Fact]
    public async Task ScheduledPassReadsOnlyWhatThePlannerAsksAndRecordsIt()
    {
        var (store, feed, synchronizer) = Create();
        Assert.Equal(1, await synchronizer.RunScheduledAsync());
        var call = Assert.Single(store.Calls);
        Assert.Equal((new DateTime(2026, 11, 3, 0, 0, 0), new DateTime(2026, 11, 3, 11, 59, 0), ProviderCallTrigger.Scheduled),
            (call.FromLocal, call.ToLocal, call.Trigger));
        Assert.Equal(1, feed.Calls);
        Assert.Null(store.Holder);
    }

    [Fact]
    public async Task NothingIsCalledWithoutConfigurationWhileAnotherHolderSyncsOrOverBudget()
    {
        var (_, unconfigured, idle) = Create(configured: false);
        Assert.Equal(0, await idle.RunScheduledAsync());
        Assert.Equal(0, unconfigured.Calls);

        var (busyStore, busyFeed, busy) = Create();
        busyStore.Holder = Guid.NewGuid();
        Assert.Equal(0, await busy.RunScheduledAsync());
        Assert.Equal(0, busyFeed.Calls);

        var (spentStore, spentFeed, spent) = Create();
        spentStore.UnitsToday = 1199;
        Assert.Equal(0, await spent.RunScheduledAsync());
        Assert.Equal(FlightFeedRefreshStatus.BudgetExhausted, (await spent.RefreshNowAsync(Guid.NewGuid(), Puj.StationPublicId)).Status);
        Assert.Equal(0, spentFeed.Calls);
    }

    [Fact]
    public async Task AQuotaErrorPausesAndStopsThePass()
    {
        var (store, feed, synchronizer) = Create(outcome: ProviderCallOutcome.QuotaExceeded);
        store.Stations.Add(Puj with { StationId = 2, Code = "SDQ", AirportIataCode = "SDQ" });
        Assert.Equal(1, await synchronizer.RunScheduledAsync());
        Assert.Equal(1, feed.Calls);
        Assert.Equal(new DateTimeOffset(2026, 11, 4, 0, 5, 0, TimeSpan.Zero), store.PausedUntil);
        Assert.Equal(0, await synchronizer.RunScheduledAsync());
    }

    [Fact]
    public async Task ManualRefreshIsThrottledReusedAndAuthorized()
    {
        var (store, feed, synchronizer) = Create();
        var refreshed = await synchronizer.RefreshNowAsync(Guid.NewGuid(), Puj.StationPublicId);
        Assert.Equal((FlightFeedRefreshStatus.Refreshed, Now.AddMinutes(10)), (refreshed.Status, refreshed.RetryAt));
        var call = Assert.Single(store.Calls);
        Assert.Equal((new DateTime(2026, 11, 3, 8, 0, 0), new DateTime(2026, 11, 3, 20, 0, 0), ProviderCallTrigger.Manual),
            (call.FromLocal, call.ToLocal, call.Trigger));

        var again = await synchronizer.RefreshNowAsync(Guid.NewGuid(), Puj.StationPublicId);
        Assert.Equal((FlightFeedRefreshStatus.Throttled, Now.AddMinutes(10)), (again.Status, again.RetryAt));

        var (reuseStore, reuseFeed, reuse) = Create();
        reuseStore.Fetches.Add(new FlightFeedFetch(new DateTime(2026, 11, 3, 8, 0, 0), new DateTime(2026, 11, 3, 20, 0, 0),
            Now.AddMinutes(-3)));
        Assert.Equal(FlightFeedRefreshStatus.Reused, (await reuse.RefreshNowAsync(Guid.NewGuid(), Puj.StationPublicId)).Status);
        Assert.Equal(0, reuseFeed.Calls);

        var (deniedStore, _, denied) = Create();
        deniedStore.Authorized = false;
        Assert.Equal(FlightFeedRefreshStatus.Forbidden, (await denied.RefreshNowAsync(Guid.NewGuid(), Puj.StationPublicId)).Status);
        Assert.Equal(1, feed.Calls);
    }

    private static (FakeStore Store, FakeFeed Feed, FlightFeedSynchronizer Synchronizer) Create(bool configured = true,
        ProviderCallOutcome outcome = ProviderCallOutcome.Succeeded)
    {
        var store = new FakeStore();
        store.Stations.Add(Puj);
        var feed = new FakeFeed(configured, outcome);
        return (store, feed, new FlightFeedSynchronizer(store, feed, new FixedTime(Now), FlightFeedBudget.Default));
    }

    private sealed class FakeFeed(bool configured, ProviderCallOutcome outcome) : IAirportFlightFeed
    {
        public int Calls { get; private set; }

        public string Provider => "Fake";

        public bool IsConfigured => configured;

        public int UnitsPerCall => 2;

        public TimeSpan MaxWindow => TimeSpan.FromHours(12);

        public Task<AirportFeedResponse> GetFlightsAsync(string airportIataCode, DateTime fromLocal, DateTime toLocal,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new AirportFeedResponse(outcome, outcome == ProviderCallOutcome.Succeeded ? 2 : 0, 200, null, []));
        }
    }

    private sealed class FakeStore : IFlightFeedSyncStore
    {
        public List<FlightFeedStation> Stations { get; } = [];
        public List<FlightFeedCall> Calls { get; } = [];
        public List<FlightFeedFetch> Fetches { get; } = [];
        public Guid? Holder { get; set; }
        public DateTimeOffset? PausedUntil { get; private set; }
        public int Failures { get; private set; }
        public int UnitsToday { get; set; }
        public bool Authorized { get; set; } = true;

        public Task<bool> TryAcquireLeaseAsync(string provider, Guid holder, DateTimeOffset now, DateTimeOffset until,
            CancellationToken cancellationToken = default)
        {
            if (Holder is not null && Holder != holder) return Task.FromResult(false);
            Holder = holder;
            return Task.FromResult(true);
        }

        public Task ReleaseLeaseAsync(string provider, Guid holder, CancellationToken cancellationToken = default)
        {
            if (Holder == holder) Holder = null;
            return Task.CompletedTask;
        }

        public Task<FlightFeedProviderState> GetStateAsync(string provider, DateTimeOffset now,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new FlightFeedProviderState(PausedUntil, Failures, null, UnitsToday, UnitsToday));

        public Task SetPauseAsync(string provider, DateTimeOffset? pausedUntil, int consecutiveFailures, string? lastError,
            CancellationToken cancellationToken = default)
        {
            (PausedUntil, Failures) = (pausedUntil, consecutiveFailures);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<FlightFeedStation>> ListStationsAsync(DateTimeOffset now,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<FlightFeedStation>>(Stations);

        public Task<FlightFeedStationActivity> GetActivityAsync(string provider, FlightFeedStation station, DateTimeOffset now,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new FlightFeedStationActivity(true, true, [], Fetches,
                Calls.Where(call => call.Trigger == ProviderCallTrigger.Manual).Select(call => (DateTimeOffset?)call.OccurredAt).Max()));

        public Task<FlightFeedIngestResult> RecordAsync(FlightFeedCall call, AirportFeedResponse response,
            CancellationToken cancellationToken = default)
        {
            Calls.Add(call);
            UnitsToday += response.Units;
            return Task.FromResult(new FlightFeedIngestResult(0, 0, 0, 0, 0, 0));
        }

        public Task<FlightFeedStation?> AuthorizeManualRefreshAsync(Guid actorId, Guid stationId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Authorized ? Stations.FirstOrDefault(station => station.StationPublicId == stationId) : null);
    }

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
