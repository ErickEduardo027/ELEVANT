using System.Collections.Concurrent;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Integrations;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Integration.AviationReference;

/// <summary>
/// The only caller of <see cref="IAviationReferenceProvider"/> (ADR-0028, note of 15 November 2026). A read is asked of
/// the provider only when a screen wants it and the cache in memory does not hold a fresh answer; one call per subject at
/// a time, whatever the number of screens. Before calling it checks the caps of the read (units of the UTC day and of
/// the UTC month) and the ceiling every operation of the provider shares, counted in the usage ledger; every call is
/// recorded there. A cap reached, a provider that is off, failing or being waited out answers a typed state, with the
/// last value kept when there is one: never an exception. Nothing here runs at startup or in the background.
/// </summary>
public sealed class AviationReferenceReader(IAviationReferenceProvider provider, AviationReferenceLimits limits,
    TimeProvider timeProvider)
{
    /// <summary>How long a subject whose call failed is not asked again.</summary>
    public static readonly TimeSpan FailureBackOff = TimeSpan.FromMinutes(5);

    /// <summary>How long a rejected credential stops every call, as the flight feed does.</summary>
    public static readonly TimeSpan UnauthorizedPause = TimeSpan.FromHours(6);

    private const int MaxEntries = 4096;

    private readonly ConcurrentDictionary<string, Entry> _cache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates = new(StringComparer.Ordinal);
    private long _pausedUntilTicks;

    public bool IsConfigured => provider.IsConfigured;

    /// <summary>
    /// The read <paramref name="kind"/> of <paramref name="subject"/> (already normalized), through the cache.
    /// <paramref name="call"/> asks the provider; <paramref name="items"/> counts what an answer brought for the ledger.
    /// </summary>
    public async Task<AviationReferenceRead<T>> ReadAsync<T>(AviationReferenceKind kind, string subject,
        Func<IAviationReferenceProvider, CancellationToken, Task<ReferenceCall<T>>> call, Func<T, int> items,
        IProviderUsageLedger ledger, Guid? stationId, Guid? requestedBy, CancellationToken cancellationToken = default)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(call);
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(ledger);
        if (!provider.IsConfigured || !limits.IsEnabled(kind))
            return new AviationReferenceRead<T>(AviationReferenceStatus.Disabled, null, null);

        var key = $"{kind}|{subject}";
        if (Kept<T>(key, timeProvider.GetUtcNow()) is { } kept) return kept;
        var gate = _gates.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        try
        {
            var now = timeProvider.GetUtcNow();
            if (Kept<T>(key, now) is { } fresh) return fresh;
            var stale = _cache.TryGetValue(key, out var old) ? old : null;
            if (new DateTimeOffset(Interlocked.Read(ref _pausedUntilTicks), TimeSpan.Zero) > now)
                return Stale<T>(AviationReferenceStatus.Unavailable, stale);

            var cap = limits.For(kind);
            var operation = AviationReferenceLimits.Operation(kind);
            var totals = await ledger.GetTotalsAsync(provider.Provider, operation, now, cancellationToken);
            if (totals.OperationThisMonth + cap.UnitsPerCall > cap.MonthlyUnits ||
                totals.ProviderThisMonth + cap.UnitsPerCall > limits.ProviderMonthlyUnits)
                return Stale<T>(AviationReferenceStatus.MonthlyLimitReached, stale);
            if (totals.OperationToday + cap.UnitsPerCall > cap.DailyUnits)
                return Stale<T>(AviationReferenceStatus.DailyLimitReached, stale);

            ReferenceCall<T> answer;
            try
            {
                answer = await call(provider, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception)
            {
                answer = ReferenceCall<T>.Failure(ProviderCallOutcome.Failed, 0, null);
            }

            var result = Settle(key, answer, cap, stale, now);
            try
            {
                // Recorded even when the screen went away: the units were spent.
                await ledger.RecordAsync(new ProviderUsageRecord(provider.Provider, operation, stationId, answer.Units,
                    answer.HttpStatus, answer.Outcome, ProviderCallTrigger.OnDemand, requestedBy,
                    answer.Value is { } value ? items(value) : 0, now), CancellationToken.None);
            }
            catch (Exception)
            {
                // A ledger that cannot write leaves the answer kept: the next read uses the cache, not the provider.
            }
            return result;
        }
        finally
        {
            gate.Release();
        }
    }

    private AviationReferenceRead<T> Settle<T>(string key, ReferenceCall<T> answer, AviationReferenceCap cap, Entry? stale,
        DateTimeOffset now)
        where T : class
    {
        switch (answer.Outcome)
        {
            case ProviderCallOutcome.Succeeded when answer.Value is not null:
                Keep(key, new Entry(AviationReferenceStatus.Available, answer.Value, now, now + cap.CacheFor, null));
                return new AviationReferenceRead<T>(AviationReferenceStatus.Available, answer.Value, now);
            case ProviderCallOutcome.Succeeded or ProviderCallOutcome.NoContent:
                Keep(key, new Entry(AviationReferenceStatus.NotFound, null, now, now + cap.CacheFor, null));
                return new AviationReferenceRead<T>(AviationReferenceStatus.NotFound, null, now);
            case ProviderCallOutcome.QuotaExceeded:
                Pause(new DateTimeOffset(now.UtcDateTime.Date.AddDays(1), TimeSpan.Zero));
                return Stale<T>(AviationReferenceStatus.MonthlyLimitReached, stale);
            case ProviderCallOutcome.Unauthorized:
                Pause(now + UnauthorizedPause);
                return Stale<T>(AviationReferenceStatus.Unavailable, stale);
            case ProviderCallOutcome.RateLimited:
                Pause(now + (answer.RetryAfter is { } wait && wait > TimeSpan.Zero ? wait : TimeSpan.FromMinutes(1)));
                return Stale<T>(AviationReferenceStatus.Unavailable, stale);
            default:
                Keep(key, stale is null
                    ? new Entry(AviationReferenceStatus.Unavailable, null, null, now, now + FailureBackOff)
                    : stale with { FailedUntil = now + FailureBackOff });
                return Stale<T>(AviationReferenceStatus.Unavailable, stale);
        }
    }

    /// <summary>A fresh answer, or the state of a subject whose last call failed a moment ago; null when it is due.</summary>
    private AviationReferenceRead<T>? Kept<T>(string key, DateTimeOffset now)
        where T : class
    {
        if (!_cache.TryGetValue(key, out var entry)) return null;
        if (entry.FailedUntil > now) return Stale<T>(AviationReferenceStatus.Unavailable, entry);
        return entry.ExpiresAt > now ? new AviationReferenceRead<T>(entry.Status, entry.Value as T, entry.RetrievedAt) : null;
    }

    private static AviationReferenceRead<T> Stale<T>(AviationReferenceStatus status, Entry? entry)
        where T : class =>
        new(status, entry?.Value as T, entry?.Value is null ? null : entry.RetrievedAt);

    private void Keep(string key, Entry entry)
    {
        if (_cache.Count >= MaxEntries)
        {
            var now = timeProvider.GetUtcNow();
            foreach (var (name, item) in _cache)
                if (item.ExpiresAt <= now && !(item.FailedUntil > now)) _cache.TryRemove(name, out _);
        }
        _cache[key] = entry;
    }

    private void Pause(DateTimeOffset until)
    {
        long current;
        do
        {
            current = Interlocked.Read(ref _pausedUntilTicks);
            if (current >= until.UtcTicks) return;
        }
        while (Interlocked.CompareExchange(ref _pausedUntilTicks, until.UtcTicks, current) != current);
    }

    private sealed record Entry(AviationReferenceStatus Status, object? Value, DateTimeOffset? RetrievedAt,
        DateTimeOffset ExpiresAt, DateTimeOffset? FailedUntil);
}
