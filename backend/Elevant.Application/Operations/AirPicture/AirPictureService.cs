using System.Collections.Concurrent;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// The live aircraft of the OCC map (ADR-0042, contracts 1.3): one reader, the air traffic worker, asks the network and
/// every screen is served from memory. Nothing is persisted; a restart starts empty.
/// <list type="bullet">
/// <item>Demand-driven: every read of the map or of a track is demand for <see cref="AirTrafficSettings.IdleAfter"/>.
/// Without demand the network is never called; the first read after a quiet spell wakes the worker and answers
/// <see cref="AirPictureStatus.Warming"/>.</item>
/// <item>One network read per interval for every screen, and after a refusal or a failure the wait of
/// <see cref="AirTrafficBackOff"/>: never a loop.</item>
/// <item>The trails live in memory (<see cref="AirTrailBuffer"/>): only an aircraft's last segment is ever served.</item>
/// <item>The picture's state is swapped whole after each read, so a screen's read never waits for the network or the
/// worker.</item>
/// </list>
/// </summary>
public sealed class AirPictureService
{
    /// <summary>The picture is live while its data is no older than this or two and a half intervals.</summary>
    public static TimeSpan MinimumLiveAge { get; } = TimeSpan.FromSeconds(30);

    /// <summary>Data older than this is no longer shown.</summary>
    public static TimeSpan StaleLimit { get; } = TimeSpan.FromMinutes(10);

    /// <summary>How long the flight keys of a station are reused before they are read again.</summary>
    public static TimeSpan MatchKeysLifetime { get; } = TimeSpan.FromSeconds(20);

    /// <summary>The pace a screen asks again at while the first read after a quiet spell is on its way.</summary>
    public const int WarmingRefreshSeconds = 2;

    /// <summary>The pace a screen asks again at while nothing is configured.</summary>
    public const int DisabledRefreshSeconds = 60;

    /// <summary>The fastest pace a screen asks again at otherwise.</summary>
    public const int MinimumRefreshSeconds = 10;

    /// <summary>The slowest pace a screen asks again at otherwise.</summary>
    public const int MaximumRefreshSeconds = 60;

    private readonly IAirTrafficProvider _provider;
    private readonly AirTrafficSettings _settings;
    private readonly TimeProvider _time;
    private readonly TimeSpan _liveAge;
    private readonly Lock _gate = new();
    private readonly AirTrailBuffer _trails;
    private readonly ConcurrentDictionary<Guid, StationMatchKeys> _matchKeys = new();
    private PictureState _state;
    private DateTimeOffset? _lastDemandAt;
    private TaskCompletionSource _demand = NewSignal();
    private bool _reading;
    private int _failures;

    public AirPictureService(IAirTrafficProvider provider, AirTrafficSettings settings, TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(provider);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(time);
        if (settings.Interval <= TimeSpan.Zero || settings.IdleAfter <= TimeSpan.Zero || settings.TrailRetention <= TimeSpan.Zero)
            throw new ArgumentException("The interval, the idle time and the trail retention must be positive.", nameof(settings));
        _provider = provider;
        _settings = settings;
        _time = time;
        IsEnabled = settings.Enabled && provider.IsConfigured;
        var liveAge = settings.Interval * 2.5;
        _liveAge = liveAge > MinimumLiveAge ? liveAge : MinimumLiveAge;
        _trails = new AirTrailBuffer(settings.TrailRetention);
        _state = new PictureState(null, null, false, null, null, settings.Interval, null);
    }

    /// <summary>
    /// Whether the picture can ever be read: <c>AirTraffic:Enabled</c> is on and a network is configured. Otherwise every
    /// read answers <see cref="AirPictureStatus.Disabled"/> and nothing is ever called.
    /// </summary>
    public bool IsEnabled { get; }

    /// <summary>Whether a screen read the map or a track less than <see cref="AirTrafficSettings.IdleAfter"/> ago.</summary>
    public bool HasDemand
    {
        get
        {
            lock (_gate) return HasDemandAt(_time.GetUtcNow());
        }
    }

    /// <summary>
    /// A screen read the map or a track: the network is read for <see cref="AirTrafficSettings.IdleAfter"/> more. After a
    /// quiet spell it starts a new watch, which is <see cref="AirPictureStatus.Warming"/> until its first read ends, and it
    /// wakes the worker. Nothing at all while the picture is disabled.
    /// </summary>
    public void NoteDemand()
    {
        if (!IsEnabled) return;
        lock (_gate)
        {
            var now = _time.GetUtcNow();
            if (!HasDemandAt(now)) Volatile.Write(ref _state, _state with { WatchStartedAt = now });
            _lastDemandAt = now;
            _demand.TrySetResult();
        }
    }

    /// <summary>
    /// Ends at once while there is demand; otherwise when a screen next reads the map, or with the cancellation. Without a
    /// configured network only the cancellation ends it.
    /// </summary>
    public Task WaitForDemandAsync(CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested) return Task.FromCanceled(cancellationToken);
        Task signal;
        lock (_gate)
        {
            if (HasDemandAt(_time.GetUtcNow())) return Task.CompletedTask;
            if (_demand.Task.IsCompleted) _demand = NewSignal();
            signal = _demand.Task;
        }
        return signal.WaitAsync(cancellationToken);
    }

    /// <summary>
    /// One read of the network when one is due, and the wait until the next: the interval after a success, the wait of
    /// <see cref="AirTrafficBackOff"/> after a refusal or a failure, and the interval again when another network of the
    /// list took over. Before the next read is due, or while another read is on its way, it calls nothing and answers the
    /// time left. Disabled, it never calls anything. Only the cancellation is thrown.
    /// </summary>
    public async Task<TimeSpan> PollOnceAsync(CancellationToken cancellationToken)
    {
        if (!IsEnabled) return _settings.Interval;
        lock (_gate)
        {
            var state = _state;
            if (_reading) return state.CurrentWait;
            var now = _time.GetUtcNow();
            // A clock set back never stretches the wait beyond the one the last read set.
            if (state.NextReadAt is { } due && now < due) return due - now < state.CurrentWait ? due - now : state.CurrentWait;
            _reading = true;
        }

        AirTrafficReadResult result;
        try
        {
            result = await _provider.ReadAsync(_settings.Area, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            lock (_gate) _reading = false;
            throw;
        }
        catch (Exception)
        {
            // The port answers refusals and failures as outcomes; anything it throws instead is a failed read too.
            result = AirTrafficReadResult.Failure(AirTrafficOutcome.Failed, _provider.Attribution);
        }

        lock (_gate)
        {
            _reading = false;
            return Integrate(result, _time.GetUtcNow());
        }
    }

    /// <summary>
    /// The picture now, from memory; it never calls the network. With <paramref name="shortTrails"/> every aircraft carries
    /// the last points of its trail (at most eight, oldest first), otherwise none. A read of the map calls
    /// <see cref="NoteDemand"/> first, so the first one after a quiet spell answers Warming and wakes the worker.
    /// <list type="bullet">
    /// <item><see cref="AirPictureStatus.Disabled"/> (<c>not_configured</c>, every 60 seconds) while nothing is configured.</item>
    /// <item><see cref="AirPictureStatus.Warming"/> (every 2 seconds) from a new watch until its first read ends, unless a
    /// failure's wait is still running.</item>
    /// <item><see cref="AirPictureStatus.Live"/> while the last good read is no older than 30 seconds or two and a half
    /// intervals; <see cref="AirPictureStatus.Stale"/> up to ten minutes, with the reason of the last attempt when it
    /// failed; then <see cref="AirPictureStatus.Unavailable"/>, with the reason and no aircraft.</item>
    /// </list>
    /// </summary>
    public AirPictureSnapshot Read(bool shortTrails)
    {
        var now = _time.GetUtcNow();
        if (!IsEnabled)
            return new AirPictureSnapshot(AirPictureStatus.Disabled, AirPictureReasons.NotConfigured, now, null, null,
                DisabledRefreshSeconds, null, []);
        var state = Volatile.Read(ref _state);
        if (IsWarming(state, now))
            return new AirPictureSnapshot(AirPictureStatus.Warming, null, now, null, null, WarmingRefreshSeconds,
                _provider.Attribution, []);

        var refresh = RefreshSeconds(state.CurrentWait);
        var seen = state.LastSuccess;
        if (seen is null)
            return new AirPictureSnapshot(AirPictureStatus.Unavailable, state.LastFailureReason ?? AirPictureReasons.ProviderError,
                now, null, null, refresh, _provider.Attribution, []);
        var age = now > seen.ObservedAt ? now - seen.ObservedAt : TimeSpan.Zero;
        var ageSeconds = (int)Math.Min(int.MaxValue, Math.Floor(age.TotalSeconds));
        var aircraft = shortTrails ? seen.WithTrails : seen.WithoutTrails;
        if (age <= _liveAge)
            return new AirPictureSnapshot(AirPictureStatus.Live, null, now, seen.ObservedAt, ageSeconds, refresh, seen.Source,
                aircraft);
        if (age <= StaleLimit)
            return new AirPictureSnapshot(AirPictureStatus.Stale, state.LastReadFailed ? state.LastFailureReason : null, now,
                seen.ObservedAt, ageSeconds, refresh, seen.Source, aircraft);
        // A last read that succeeded with data this old is unusable too.
        return new AirPictureSnapshot(AirPictureStatus.Unavailable,
            state.LastReadFailed ? state.LastFailureReason : AirPictureReasons.ProviderError, now, seen.ObservedAt, ageSeconds,
            refresh, _provider.Attribution, []);
    }

    /// <summary>
    /// The trail of one aircraft from memory: its last segment, at most 600 points, oldest first. Null when no read saw
    /// that address in the last fifteen minutes, or while the picture is disabled. It never calls the network.
    /// </summary>
    public AirTrackData? Track(string hex)
    {
        if (!IsEnabled || string.IsNullOrWhiteSpace(hex)) return null;
        var key = hex.Trim().ToLowerInvariant();
        var now = _time.GetUtcNow();
        IReadOnlyList<AirTrailPoint>? points;
        lock (_gate) points = _trails.Track(key, now);
        if (points is null) return null;
        return new AirTrackData(key, now, Volatile.Read(ref _state).LastSuccess?.Source ?? _provider.Attribution, points);
    }

    /// <summary>
    /// The flight keys of a station for <see cref="FlightAircraftMatcher"/>, kept <see cref="MatchKeysLifetime"/>: within
    /// it every caller gets the same keys and <paramref name="load"/> is not called. One load at a time per station: while
    /// one runs, the others get the keys known so far, or wait for the first ones. A load that fails keeps the keys known
    /// so far (or none) for the same twenty seconds, so the picture keeps answering; only the cancellation is thrown.
    /// </summary>
    public async Task<IReadOnlyList<MapFlightMatchKey>> MatchKeysAsync(Guid stationId,
        Func<CancellationToken, Task<IReadOnlyList<MapFlightMatchKey>>> load, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(load);
        var station = _matchKeys.GetOrAdd(stationId, static _ => new StationMatchKeys());
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            MatchKeys? known;
            Task? running;
            TaskCompletionSource? loading = null;
            lock (station.Gate)
            {
                known = station.Keys;
                if (known is not null && IsFresh(known.LoadedAt)) return known.Keys;
                running = station.Loading;
                if (running is null)
                {
                    loading = NewSignal();
                    station.Loading = loading.Task;
                }
            }

            if (loading is null)
            {
                if (known is not null) return known.Keys;
                await running!.WaitAsync(cancellationToken);
                continue;
            }

            try
            {
                var startedAt = _time.GetUtcNow();
                IReadOnlyList<MapFlightMatchKey> keys;
                try
                {
                    keys = await load(cancellationToken) ?? [];
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception)
                {
                    // The database is out of reach: the picture keeps answering with what it knew.
                    keys = known?.Keys ?? [];
                }
                lock (station.Gate) station.Keys = new MatchKeys(keys, startedAt);
                return keys;
            }
            finally
            {
                lock (station.Gate) station.Loading = null;
                loading.TrySetResult();
            }
        }
    }

    private bool HasDemandAt(DateTimeOffset now) => _lastDemandAt is { } last && now - last < _settings.IdleAfter;

    private bool IsFresh(DateTimeOffset loadedAt)
    {
        var now = _time.GetUtcNow();
        return now >= loadedAt && now - loadedAt < MatchKeysLifetime;
    }

    /// <summary>Stores what one read brought and answers the wait until the next. Called under the gate.</summary>
    private TimeSpan Integrate(AirTrafficReadResult result, DateTimeOffset now)
    {
        var state = _state;
        TimeSpan wait;
        if (result.Outcome == AirTrafficOutcome.Succeeded)
        {
            _failures = 0;
            var aircraft = Freshest(result.Aircraft);
            _trails.Record(aircraft, now);
            _trails.Prune(now);
            wait = AirTrafficBackOff.Next(AirTrafficOutcome.Succeeded, 0, null, _settings.Interval);
            state = state with
            {
                LastReadFailed = false,
                LastFailureReason = null,
                LastSuccess = new Sighting(result.ObservedAt ?? now, result.Source ?? _provider.Attribution,
                    [.. aircraft.Select(item => new AirPictureAircraft(item, _trails.Short(item.Hex)))],
                    [.. aircraft.Select(item => new AirPictureAircraft(item, []))]),
            };
        }
        else
        {
            _trails.Prune(now);
            wait = AirTrafficBackOff.Next(result.Outcome, ++_failures, result.RetryAfter, _settings.Interval);
            if (!Equals(_provider.Attribution, result.Source))
            {
                // Another network of the list took over after this failure: it is asked at the normal pace, and its own
                // failures are counted from the start.
                wait = _settings.Interval;
                _failures = 0;
            }
            state = state with { LastReadFailed = true, LastFailureReason = AirPictureReasons.Of(result.Outcome) };
        }
        Volatile.Write(ref _state, state with { LastReadAt = now, NextReadAt = now + wait, CurrentWait = wait });
        return wait;
    }

    private static bool IsWarming(PictureState state, DateTimeOffset now)
    {
        // A read ended since the watch started: the picture says what it found.
        if (state.LastReadAt is { } read && (state.WatchStartedAt is not { } started || read >= started)) return false;
        // A failure's wait is still running: no read comes before it ends, so the picture says what failed instead.
        return !(state.LastReadFailed && state.NextReadAt is { } next && next > now);
    }

    private static int RefreshSeconds(TimeSpan wait) =>
        (int)Math.Clamp(Math.Ceiling(wait.TotalSeconds), MinimumRefreshSeconds, MaximumRefreshSeconds);

    /// <summary>The aircraft of a read, one per address: the freshest position wins, the first order stays.</summary>
    private static AirTrafficAircraft[] Freshest(IReadOnlyList<AirTrafficAircraft> aircraft)
    {
        var indexOf = new Dictionary<string, int>(StringComparer.Ordinal);
        var distinct = new List<AirTrafficAircraft>(aircraft.Count);
        foreach (var item in aircraft)
        {
            if (item is null || string.IsNullOrWhiteSpace(item.Hex)) continue;
            if (!indexOf.TryGetValue(item.Hex, out var index))
            {
                indexOf[item.Hex] = distinct.Count;
                distinct.Add(item);
            }
            else if (item.PositionAt > distinct[index].PositionAt)
            {
                distinct[index] = item;
            }
        }
        return [.. distinct];
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>
    /// What the reads left, swapped whole: when the current watch started, when the last read ended and whether it failed
    /// (with its reason), when the next one is due and the wait that set it, and the last good read.
    /// </summary>
    private sealed record PictureState(DateTimeOffset? WatchStartedAt, DateTimeOffset? LastReadAt, bool LastReadFailed,
        string? LastFailureReason, DateTimeOffset? NextReadAt, TimeSpan CurrentWait, Sighting? LastSuccess);

    /// <summary>A good read: the instant the network described, its credit and its aircraft with and without trails.</summary>
    private sealed record Sighting(DateTimeOffset ObservedAt, AirTrafficAttribution? Source,
        IReadOnlyList<AirPictureAircraft> WithTrails, IReadOnlyList<AirPictureAircraft> WithoutTrails);

    private sealed record MatchKeys(IReadOnlyList<MapFlightMatchKey> Keys, DateTimeOffset LoadedAt);

    private sealed class StationMatchKeys
    {
        public Lock Gate { get; } = new();

        public MatchKeys? Keys { get; set; }

        public Task? Loading { get; set; }
    }
}
