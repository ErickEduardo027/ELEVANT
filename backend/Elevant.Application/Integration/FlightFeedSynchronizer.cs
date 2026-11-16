using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Integration;

public enum FlightFeedRefreshStatus
{
    Refreshed,
    Reused,
    Throttled,
    BudgetExhausted,
    Paused,
    NotConfigured,
    NoContracts,
    Busy,
    Failed,
    Forbidden,
}

/// <summary>Result of «Actualizar ahora». <paramref name="RetryAt"/> says when it can be asked again.</summary>
public sealed record FlightFeedRefreshResult(FlightFeedRefreshStatus Status, DateTimeOffset? RetryAt,
    FlightFeedIngestResult? Ingest);

/// <summary>
/// The only caller of the paid flight feed (ADR-0028). The worker runs <see cref="RunScheduledAsync"/>
/// every minute and <see cref="FlightFeedPlanner"/> decides whether a station needs a read; OCC
/// can ask for one read with <see cref="RefreshNowAsync"/>, at most every ten minutes per station.
/// Every call goes through the provider's lease, the budget and the pause after errors.
/// </summary>
public sealed class FlightFeedSynchronizer(
    IFlightFeedSyncStore store, IAirportFlightFeed feed, TimeProvider timeProvider, FlightFeedBudget budget)
{
    public static readonly TimeSpan ManualInterval = TimeSpan.FromMinutes(10);
    public static readonly TimeSpan ReuseWindow = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan UnauthorizedPause = TimeSpan.FromHours(6);
    private static readonly TimeSpan MaxBackOff = TimeSpan.FromHours(1);

    /// <summary>One scheduled pass over every station; returns how many calls it made.</summary>
    public async Task<int> RunScheduledAsync(CancellationToken cancellationToken = default)
    {
        if (!feed.IsConfigured) return 0;
        var holder = Guid.NewGuid();
        var now = timeProvider.GetUtcNow();
        if (!await store.TryAcquireLeaseAsync(feed.Provider, holder, now, now + LeaseDuration, cancellationToken)) return 0;
        var calls = 0;
        try
        {
            foreach (var station in await store.ListStationsAsync(now, cancellationToken))
            {
                var decision = await DecideAsync(station, cancellationToken);
                if (decision.Reason is "paused" or "budget_exhausted") break;
                if (!decision.ShouldFetch) continue;
                calls++;
                var response = await CallAsync(station, decision.FromLocal!.Value, decision.ToLocal!.Value,
                    ProviderCallTrigger.Scheduled, null, cancellationToken);
                if (response.Outcome is not (ProviderCallOutcome.Succeeded or ProviderCallOutcome.NoContent)) break;
            }
        }
        finally
        {
            await store.ReleaseLeaseAsync(feed.Provider, holder, CancellationToken.None);
        }
        return calls;
    }

    /// <summary>«Actualizar ahora» for a station: reads the active window once, within the same limits.</summary>
    public async Task<FlightFeedRefreshResult> RefreshNowAsync(Guid actorId, Guid stationId,
        CancellationToken cancellationToken = default)
    {
        var station = await store.AuthorizeManualRefreshAsync(actorId, stationId, cancellationToken);
        if (station is null) return new(FlightFeedRefreshStatus.Forbidden, null, null);
        if (!feed.IsConfigured) return new(FlightFeedRefreshStatus.NotConfigured, null, null);
        var now = timeProvider.GetUtcNow();
        var state = await store.GetStateAsync(feed.Provider, now, cancellationToken);
        if (state.PausedUntil is { } paused && paused > now) return new(FlightFeedRefreshStatus.Paused, paused, null);
        if (state.UnitsToday + feed.UnitsPerCall > budget.DailyUnits ||
            state.UnitsThisMonth + feed.UnitsPerCall > budget.MonthlyUnits)
            return new(FlightFeedRefreshStatus.BudgetExhausted, null, null);
        var activity = await store.GetActivityAsync(feed.Provider, station, now, cancellationToken);
        if (!activity.HasContractsToday) return new(FlightFeedRefreshStatus.NoContracts, null, null);
        if (activity.LastManualRefreshAt is { } lastManual && now - lastManual < ManualInterval)
            return new(FlightFeedRefreshStatus.Throttled, lastManual + ManualInterval, null);

        var zone = TimeZoneInfo.FindSystemTimeZoneById(station.TimeZoneId);
        var nowLocal = TimeZoneInfo.ConvertTime(now, zone).DateTime;
        // A read that already covers now and is only minutes old is reused instead of paid again.
        if (activity.RecentFetches.Any(fetch => fetch.FromLocal <= nowLocal && nowLocal <= fetch.ToLocal &&
                now - fetch.OccurredAt < ReuseWindow))
            return new(FlightFeedRefreshStatus.Reused, null, null);

        var holder = Guid.NewGuid();
        if (!await store.TryAcquireLeaseAsync(feed.Provider, holder, now, now + LeaseDuration, cancellationToken))
            return new(FlightFeedRefreshStatus.Busy, now.AddMinutes(1), null);
        try
        {
            var from = new DateTime(nowLocal.Year, nowLocal.Month, nowLocal.Day, nowLocal.Hour, nowLocal.Minute, 0).AddHours(-2);
            var (response, ingest) = await CallAndRecordAsync(station, from, from + feed.MaxWindow,
                ProviderCallTrigger.Manual, actorId, cancellationToken);
            return response.Outcome is ProviderCallOutcome.Succeeded or ProviderCallOutcome.NoContent
                ? new(FlightFeedRefreshStatus.Refreshed, now + ManualInterval, ingest)
                : new(FlightFeedRefreshStatus.Failed, null, null);
        }
        finally
        {
            await store.ReleaseLeaseAsync(feed.Provider, holder, CancellationToken.None);
        }
    }

    private async Task<FlightFeedDecision> DecideAsync(FlightFeedStation station, CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        var state = await store.GetStateAsync(feed.Provider, now, cancellationToken);
        var activity = await store.GetActivityAsync(feed.Provider, station, now, cancellationToken);
        return FlightFeedPlanner.Next(new FlightFeedPlannerInput(now, TimeZoneInfo.FindSystemTimeZoneById(station.TimeZoneId),
            activity.HasContractsToday, activity.HasContractsTomorrow, activity.ContractedFlightTimesToday,
            activity.RecentFetches, state.UnitsToday, state.UnitsThisMonth, budget, feed.UnitsPerCall, feed.MaxWindow,
            state.PausedUntil));
    }

    private async Task<AirportFeedResponse> CallAsync(FlightFeedStation station, DateTime from, DateTime to,
        ProviderCallTrigger trigger, Guid? actorId, CancellationToken cancellationToken) =>
        (await CallAndRecordAsync(station, from, to, trigger, actorId, cancellationToken)).Response;

    private async Task<(AirportFeedResponse Response, FlightFeedIngestResult Ingest)> CallAndRecordAsync(
        FlightFeedStation station, DateTime from, DateTime to, ProviderCallTrigger trigger, Guid? actorId,
        CancellationToken cancellationToken)
    {
        var response = await feed.GetFlightsAsync(station.AirportIataCode, from, to, cancellationToken);
        var now = timeProvider.GetUtcNow();
        var ingest = await store.RecordAsync(new FlightFeedCall(feed.Provider, station, from, to, trigger, actorId, now),
            response, CancellationToken.None);
        var state = await store.GetStateAsync(feed.Provider, now, CancellationToken.None);
        var (pausedUntil, failures, error) = PauseAfter(response, state.ConsecutiveFailures, now);
        if (pausedUntil != state.PausedUntil || failures != state.ConsecutiveFailures)
            await store.SetPauseAsync(feed.Provider, pausedUntil, failures, error, CancellationToken.None);
        return (response, ingest);
    }

    /// <summary>
    /// Never retries in a loop: a quota error stops until the next UTC day, a rejected credential
    /// for six hours, a rate limit for what the provider asks, and other failures back off
    /// exponentially (1, 2, 4… minutes, at most one hour).
    /// </summary>
    public static (DateTimeOffset? PausedUntil, int Failures, string? Error) PauseAfter(AirportFeedResponse response,
        int previousFailures, DateTimeOffset now) => response.Outcome switch
        {
            ProviderCallOutcome.Succeeded or ProviderCallOutcome.NoContent => (null, 0, null),
            ProviderCallOutcome.QuotaExceeded => (new DateTimeOffset(now.UtcDateTime.Date.AddDays(1).AddMinutes(5), TimeSpan.Zero),
                previousFailures + 1, "quota_exceeded"),
            ProviderCallOutcome.Unauthorized => (now + UnauthorizedPause, previousFailures + 1, "unauthorized"),
            ProviderCallOutcome.RateLimited => (now + (response.RetryAfter ?? TimeSpan.FromMinutes(1)), previousFailures + 1,
                "rate_limited"),
            _ => (now + TimeSpan.FromMinutes(Math.Min(MaxBackOff.TotalMinutes, Math.Pow(2, previousFailures))),
                previousFailures + 1, $"failed_{response.HttpStatus?.ToString() ?? "network"}"),
        };
}
