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
/// <item>M3 (the map refinement of 27 November 2026): one scheduler and one bucket for every request
/// (<see cref="AirTrafficRequestBucket"/>): the reads of the whole circle and of the airfield and approach take the same
/// token, so the network is asked at most 0.8 times a second.</item>
/// <item>M3: the AVIAM flights that should be in the air and were not in the whole circle are looked up by their callsign,
/// in turn, and what the lookups find joins the same picture with its flight, in memory only.</item>
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

    /// <summary>
    /// M3: the most a callsign lookup may delay the airfield and approach read that is due after it: a lookup goes out
    /// only when the approach read is due at least the bucket's 1.25 s less this after it.
    /// </summary>
    public static TimeSpan MaxApproachSlip { get; } = TimeSpan.FromMilliseconds(500);

    /// <summary>M3: an arrival is looked up from this long after its best time on, until it happened (it is late).</summary>
    public static TimeSpan LookupArrivalsBack { get; } = TimeSpan.FromHours(1);

    /// <summary>M3: a departure is looked up until this long after its best time (the flight keys reach that far back).</summary>
    public static TimeSpan LookupDeparturesBack { get; } = TimeSpan.FromHours(2);

    /// <summary>M3: a departure is looked up from this long before its best time (it may leave a little early).</summary>
    public static TimeSpan LookupDeparturesAhead { get; } = TimeSpan.FromMinutes(15);

    private static readonly IReadOnlyDictionary<string, string> NoFoundFlights =
        new Dictionary<string, string>(StringComparer.Ordinal);

    private readonly IAirTrafficProvider _provider;
    private readonly AirTrafficSettings _settings;
    private readonly TimeProvider _time;
    private readonly TimeSpan _liveAge;
    private readonly Lock _gate = new();
    private readonly AirTrailBuffer _trails;
    private readonly ConcurrentDictionary<Guid, StationMatchKeys> _matchKeys = new();
    // M3: the one bucket every request to the network takes its token from, under the gate.
    private readonly AirTrafficRequestBucket _requests = new();
    private PictureState _state;
    private DateTimeOffset? _lastDemandAt;
    private TaskCompletionSource _demand = NewSignal();
    private bool _reading;
    private int _failures;
    // CN-31: the airfield read's own pace and its failures in a row.
    private DateTimeOffset? _nextAirfieldAt;
    private int _airfieldFailures;
    // M3: the callsign lookups' own pace, their failures in a row, the last flight looked up (the turn goes on after it),
    // the aircraft they found by address and what the last good read of the whole circle saw.
    private DateTimeOffset? _nextLookupAt;
    private int _lookupFailures;
    private string? _lastLookedUp;
    private readonly Dictionary<string, FoundAircraft> _found = new(StringComparer.Ordinal);
    private AirTrafficAircraft[] _circle = [];

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

    /// <summary>The station whose live traffic the picture shows (<c>AirTraffic:StationCode</c>).</summary>
    public string StationCode => _settings.StationCode;

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
    /// <para>CN-31 and M3: between two reads of the whole circle, while a screen watches the map, the network allows it
    /// (<see cref="IAirTrafficProvider.AllowsFrequentReads"/>: adsb.fi, not adsb.lol), the last read of the whole circle
    /// succeeded and no back-off runs, it also reads the airfield and approach circle
    /// (<see cref="AirTrafficSettings.AirfieldArea"/>) every <see cref="AirTrafficSettings.AirfieldInterval"/>: 25 NM every
    /// 2 s in Development. One scheduler (<see cref="NextRead"/>) picks every request and one bucket
    /// (<see cref="AirTrafficRequestBucket"/>) lets it out, so the network is asked at most 0.8 times a second and never
    /// twice within 1.25 s (10 s and 2 s give 0.5 a second).</para>
    /// </summary>
    public async Task<TimeSpan> PollOnceAsync(CancellationToken cancellationToken)
    {
        if (!IsEnabled) return _settings.Interval;
        UpstreamRead read;
        DateTimeOffset startedAt;
        LookupCandidate? lookup = null;
        lock (_gate)
        {
            var state = _state;
            if (_reading) return state.CurrentWait;
            startedAt = _time.GetUtcNow();
            var (next, wait) = NextRead(state, startedAt);
            if (next is not { } chosen) return wait;
            if (chosen == UpstreamRead.Callsign && (lookup = NextLookup(startedAt)) is null)
            {
                // No flight to look up now: the next turn comes a lookup interval later, and the other reads go on.
                _nextLookupAt = startedAt + AirTrafficSettings.CallsignLookupInterval;
                (next, wait) = NextRead(state, startedAt);
                if (next is not { } other) return wait;
                chosen = other;
            }
            // The scheduler names a read only while the token is back.
            if (!_requests.TryTake(startedAt)) return _requests.WaitAt(startedAt);
            read = chosen;
            _reading = true;
        }

        AirTrafficReadResult result;
        try
        {
            result = read switch
            {
                UpstreamRead.Callsign => await _provider.ReadCallsignAsync(lookup!.Callsign, cancellationToken),
                UpstreamRead.Airfield => await _provider.ReadAsync(_settings.AirfieldArea, cancellationToken),
                _ => await _provider.ReadAsync(_settings.Area, cancellationToken),
            };
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
            var now = _time.GetUtcNow();
            if (read == UpstreamRead.Airfield)
            {
                IntegrateAirfield(result, startedAt, now);
            }
            else if (read == UpstreamRead.Callsign)
            {
                IntegrateLookup(result, lookup!, startedAt, now);
            }
            else
            {
                Integrate(result, now);
                // The airfield's own pace starts again after a read of the whole circle, which covered it too.
                _nextAirfieldAt = now + _settings.AirfieldInterval;
            }
            return NextRead(_state, now).Wait;
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
                aircraft) { FoundFlightKeys = seen.FoundFlights };
        if (age <= StaleLimit)
            return new AirPictureSnapshot(AirPictureStatus.Stale, state.LastReadFailed ? state.LastFailureReason : null, now,
                seen.ObservedAt, ageSeconds, refresh, seen.Source, aircraft) { FoundFlightKeys = seen.FoundFlights };
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

    /// <summary>
    /// Whether the airfield is read at all now (CN-31): switched on, a network that allows it, a screen watching, a good
    /// last read of the whole circle to merge into and no back-off of the whole circle running. Under the gate.
    /// </summary>
    private bool AirfieldActive(PictureState state, DateTimeOffset now) =>
        _settings.AirfieldReadsEnabled && _provider.AllowsFrequentReads && HasDemandAt(now) && state.LastSuccess is not null &&
        !state.LastReadFailed;

    /// <summary>
    /// M3: the one scheduler of the requests to the network, under the gate. It answers the read that goes out at
    /// <paramref name="now"/>, or none and the wait until one may. Nothing goes out before the bucket's token is back. The
    /// whole circle goes first once it is due. The airfield goes when it is active and due, unless the whole circle would
    /// fall due before the token is back after it: that airfield read is skipped, because the whole circle covers the
    /// airfield too and is never held back by it. Then a callsign lookup, where the airfield reads run and the network
    /// answers callsigns, at most one every <see cref="AirTrafficSettings.CallsignLookupInterval"/>: it takes a slot
    /// between two approach reads only when it holds the whole circle back not at all and the approach read due after it
    /// at most <see cref="MaxApproachSlip"/>. Without a read the wait is never zero, so a pass that reads nothing always
    /// waits.
    /// </summary>
    private (UpstreamRead? Read, TimeSpan Wait) NextRead(PictureState state, DateTimeOffset now)
    {
        var token = _requests.WaitAt(now);
        // A clock set back never stretches the wait beyond the one the last read set.
        var wide = state.NextReadAt is { } due && now < due ? Min(due - now, state.CurrentWait) : TimeSpan.Zero;
        if (wide == TimeSpan.Zero && token == TimeSpan.Zero) return (UpstreamRead.WholeCircle, TimeSpan.Zero);
        var wideAt = Max(wide, token);
        if (!AirfieldActive(state, now)) return (null, wideAt);
        var airfieldDue = _nextAirfieldAt is { } next && next > now ? next - now : TimeSpan.Zero;
        var airfieldAt = Max(airfieldDue, token);
        var airfieldFits = wide - airfieldAt >= AirTrafficRequestBucket.TokenInterval;
        if (airfieldFits && airfieldAt == TimeSpan.Zero) return (UpstreamRead.Airfield, TimeSpan.Zero);
        var soonest = airfieldFits ? airfieldAt : wideAt;
        if (!LookupsActive()) return (null, soonest);
        var lookupAt = Max(_nextLookupAt is { } turn && turn > now ? turn - now : TimeSpan.Zero, token);
        var lookupFits = wide - lookupAt >= AirTrafficRequestBucket.TokenInterval &&
            (!airfieldFits || airfieldDue - lookupAt >= AirTrafficRequestBucket.TokenInterval - MaxApproachSlip);
        if (!lookupFits) return (null, soonest);
        return lookupAt == TimeSpan.Zero ? (UpstreamRead.Callsign, TimeSpan.Zero) : (null, Min(soonest, lookupAt));
    }

    /// <summary>
    /// M3: whether the callsign lookups run at all, given that the airfield reads run (<see cref="AirfieldActive"/>):
    /// switched on and a network that answers them (adsb.fi). Under the gate.
    /// </summary>
    private bool LookupsActive() => _settings.CallsignLookupsEnabled && _provider.SupportsCallsignLookups;

    /// <summary>
    /// M3: the next flight to look up by its callsign, in turn after the last one, or none. The flights are the station's
    /// match keys the screens last read (never a demo flight): an arrival that has not happened, from
    /// <see cref="LookupArrivalsBack"/> after its best time back to <see cref="FlightAircraftMatcher.ArrivalsAhead"/> before
    /// it, and a departure from <see cref="LookupDeparturesBack"/> after its best time back to
    /// <see cref="LookupDeparturesAhead"/> before it; each with its ICAO callsign, and none whose callsign or registration
    /// the last good read of the whole circle saw. Under the gate.
    /// </summary>
    private LookupCandidate? NextLookup(DateTimeOffset now)
    {
        var seenCallsigns = new HashSet<string>(StringComparer.Ordinal);
        var seenRegistrations = new HashSet<string>(StringComparer.Ordinal);
        foreach (var plane in _circle)
        {
            if (FlightAircraftMatcher.NormalizeCallsign(plane.Callsign) is { } callsign) seenCallsigns.Add(callsign);
            if (FlightAircraftMatcher.NormalizeRegistration(plane.Registration) is { } registration)
                seenRegistrations.Add(registration);
        }

        var candidates = new SortedDictionary<string, LookupCandidate>(StringComparer.Ordinal);
        foreach (var station in _matchKeys.Values)
        {
            IReadOnlyList<MapFlightMatchKey> keys;
            lock (station.Gate) keys = station.Keys?.Keys ?? [];
            foreach (var key in keys)
            {
                if (key is null || key.IsDemo || string.IsNullOrWhiteSpace(key.FlightKey) || !ShouldBeFlying(key, now) ||
                    candidates.ContainsKey(key.FlightKey))
                    continue;
                var callsign = FlightAircraftMatcher.IcaoCallsign(key.AirlineIcaoCode, key.FlightNumber);
                if (callsign is null || callsign.Length > 8 || seenCallsigns.Contains(callsign)) continue;
                if (FlightAircraftMatcher.NormalizeRegistration(key.Registration) is { } registration &&
                    seenRegistrations.Contains(registration))
                    continue;
                candidates[key.FlightKey] = new LookupCandidate(key.FlightKey, callsign);
            }
        }
        if (candidates.Count == 0) return null;
        var after = _lastLookedUp is { } last
            ? candidates.Values.FirstOrDefault(candidate => string.CompareOrdinal(candidate.FlightKey, last) > 0)
            : null;
        return after ?? candidates.Values.First();
    }

    /// <summary>M3: whether a flight should be in the air now, or is near its time (see <see cref="NextLookup"/>).</summary>
    private static bool ShouldBeFlying(MapFlightMatchKey key, DateTimeOffset now)
    {
        if (string.Equals(key.Direction, "Arrival", StringComparison.OrdinalIgnoreCase))
            return !key.Happened && key.BestTime >= now - LookupArrivalsBack &&
                key.BestTime <= now + FlightAircraftMatcher.ArrivalsAhead;
        if (string.Equals(key.Direction, "Departure", StringComparison.OrdinalIgnoreCase))
            return key.BestTime >= now - LookupDeparturesBack && key.BestTime <= now + LookupDeparturesAhead;
        return false;
    }

    /// <summary>
    /// M3: what a callsign lookup that went out at <paramref name="startedAt"/> brought, under the gate. A success takes
    /// the freshest aircraft that broadcasts exactly that callsign: it joins the picture with its flight (one aircraft per
    /// flight), and the trails record it; the next lookup is due a lookup interval after this one went out. An answer
    /// without it changes nothing: what an earlier lookup found stays until
    /// <see cref="AirTrafficSettings.CallsignLookupRetention"/> after it was last seen. A failure waits as
    /// <see cref="AirTrafficBackOff"/> says from the lookup interval, and a request to slow down (429) or a refusal holds
    /// every read back for the same wait, as an airfield refusal does.
    /// </summary>
    private void IntegrateLookup(AirTrafficReadResult result, LookupCandidate lookup, DateTimeOffset startedAt,
        DateTimeOffset now)
    {
        _lastLookedUp = lookup.FlightKey;
        if (result.Outcome == AirTrafficOutcome.Succeeded)
        {
            _lookupFailures = 0;
            _nextLookupAt = startedAt + AirTrafficSettings.CallsignLookupInterval;
            var plane = result.Aircraft
                .Where(item => item is not null && !string.IsNullOrWhiteSpace(item.Hex) &&
                    FlightAircraftMatcher.NormalizeCallsign(item.Callsign) == lookup.Callsign)
                .MaxBy(item => item.PositionAt);
            var changed = ForgetFound(now);
            if (plane is not null)
            {
                foreach (var other in _found.Where(entry => entry.Value.FlightKey == lookup.FlightKey && entry.Key != plane.Hex)
                             .Select(entry => entry.Key).ToArray())
                    _found.Remove(other);
                if (_found.TryGetValue(plane.Hex, out var known) && known.Aircraft.PositionAt > plane.PositionAt)
                    plane = known.Aircraft;
                else
                    _trails.Record([plane], now);
                _found[plane.Hex] = new FoundAircraft(plane, lookup.FlightKey, now);
                changed = true;
            }
            if (changed) PublishFound();
            return;
        }
        var wait = AirTrafficBackOff.Next(result.Outcome, ++_lookupFailures, result.RetryAfter,
            AirTrafficSettings.CallsignLookupInterval);
        _nextLookupAt = now + wait;
        if (result.Outcome is AirTrafficOutcome.RateLimited or AirTrafficOutcome.Unauthorized or AirTrafficOutcome.QuotaExceeded)
            HoldEveryRead(now + wait, wait);
    }

    /// <summary>M3: forgets the aircraft no lookup saw for the retention; true when one went. Under the gate.</summary>
    private bool ForgetFound(DateTimeOffset now)
    {
        var gone = _found.Where(entry => now - entry.Value.SeenAt > AirTrafficSettings.CallsignLookupRetention)
            .Select(entry => entry.Key).ToArray();
        foreach (var hex in gone) _found.Remove(hex);
        return gone.Length > 0;
    }

    /// <summary>
    /// M3: puts what the lookups found into the last good read: an aircraft forgotten since leaves it, a found one takes
    /// its place when its position is newer or is added. Under the gate.
    /// </summary>
    private void PublishFound()
    {
        var state = _state;
        if (state.LastSuccess is not { } seen) return;
        var found = FoundFlights();
        var kept = seen.WithoutTrails.Select(item => item.Aircraft)
            .Where(item => !seen.FoundFlights.ContainsKey(item.Hex) || found.ContainsKey(item.Hex));
        var merged = Merge(kept, _found.Values.Select(item => item.Aircraft), out _);
        Volatile.Write(ref _state, state with { LastSuccess = WithAircraft(seen, merged, found) });
    }

    private IReadOnlyDictionary<string, string> FoundFlights() => _found.Count == 0
        ? NoFoundFlights
        : _found.ToDictionary(entry => entry.Key, entry => entry.Value.FlightKey, StringComparer.Ordinal);

    /// <summary>
    /// The aircraft of <paramref name="current"/> with <paramref name="fresh"/> merged in: an address takes the fresh
    /// position only when it is newer, a new one is added at the end, the others stay as they were.
    /// </summary>
    private static List<AirTrafficAircraft> Merge(IEnumerable<AirTrafficAircraft> current,
        IEnumerable<AirTrafficAircraft> fresh, out bool changed)
    {
        var merged = current.ToList();
        var indexOf = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var index = 0; index < merged.Count; index++) indexOf[merged[index].Hex] = index;
        changed = false;
        foreach (var item in fresh)
        {
            if (!indexOf.TryGetValue(item.Hex, out var index))
            {
                indexOf[item.Hex] = merged.Count;
                merged.Add(item);
                changed = true;
            }
            else if (item.PositionAt > merged[index].PositionAt)
            {
                merged[index] = item;
                changed = true;
            }
        }
        return merged;
    }

    private Sighting WithAircraft(Sighting seen, IReadOnlyList<AirTrafficAircraft> aircraft,
        IReadOnlyDictionary<string, string> foundFlights) => seen with
    {
        WithTrails = [.. aircraft.Select(item => new AirPictureAircraft(item, _trails.Short(item.Hex)))],
        WithoutTrails = [.. aircraft.Select(item => new AirPictureAircraft(item, []))],
        FoundFlights = foundFlights,
    };

    /// <summary>
    /// A request to slow down (429) or a refusal of any read holds every read back until <paramref name="holdUntil"/>:
    /// the whole circle, the airfield and the lookups. A hold already longer stays. Under the gate.
    /// </summary>
    private void HoldEveryRead(DateTimeOffset holdUntil, TimeSpan wait)
    {
        var state = _state;
        if (state.NextReadAt is not { } next || next < holdUntil)
            Volatile.Write(ref _state, state with { NextReadAt = holdUntil, CurrentWait = wait });
        if (_nextAirfieldAt is not { } airfield || airfield < holdUntil) _nextAirfieldAt = holdUntil;
        if (_nextLookupAt is not { } lookup || lookup < holdUntil) _nextLookupAt = holdUntil;
    }

    /// <summary>
    /// What an airfield read that went out at <paramref name="startedAt"/> brought (CN-31), under the gate. A success
    /// merges its aircraft into the last good read: an address takes the airfield's position only when it is newer, a new
    /// one is added, and the others stay as the whole circle left them; the trails record it as any read. The instant of
    /// the picture stays the whole circle's, so its state (Live, Stale) still says how fresh the whole picture is. M3: after
    /// a success the next airfield read is due <see cref="AirTrafficSettings.AirfieldInterval"/> after this one went out,
    /// so a slow answer does not stretch the pace. A failure waits as <see cref="AirTrafficBackOff"/> says from the
    /// airfield interval; a request to slow down (429) or a refusal also holds the read of the whole circle back for the
    /// same wait, so one refusal slows every read (M3: the callsign lookups too).
    /// </summary>
    private void IntegrateAirfield(AirTrafficReadResult result, DateTimeOffset startedAt, DateTimeOffset now)
    {
        var state = _state;
        if (result.Outcome == AirTrafficOutcome.Succeeded)
        {
            _airfieldFailures = 0;
            _nextAirfieldAt = startedAt + _settings.AirfieldInterval;
            if (state.LastSuccess is not { } seen) return;
            var fresh = Freshest(result.Aircraft);
            _trails.Record(fresh, now);
            var merged = Merge(seen.WithoutTrails.Select(item => item.Aircraft), fresh, out var changed);
            if (!changed) return;
            Volatile.Write(ref _state, state with { LastSuccess = WithAircraft(seen, merged, seen.FoundFlights) });
            return;
        }
        var wait = AirTrafficBackOff.Next(result.Outcome, ++_airfieldFailures, result.RetryAfter, _settings.AirfieldInterval);
        _nextAirfieldAt = now + wait;
        if (result.Outcome is AirTrafficOutcome.RateLimited or AirTrafficOutcome.Unauthorized or AirTrafficOutcome.QuotaExceeded)
            HoldEveryRead(now + wait, wait);
    }

    private static TimeSpan Min(TimeSpan left, TimeSpan right) => left < right ? left : right;

    private static TimeSpan Max(TimeSpan left, TimeSpan right) => left > right ? left : right;

    private bool IsFresh(DateTimeOffset loadedAt)
    {
        var now = _time.GetUtcNow();
        return now >= loadedAt && now - loadedAt < MatchKeysLifetime;
    }

    /// <summary>Stores what one read of the whole circle brought and when the next is due. Called under the gate.</summary>
    private void Integrate(AirTrafficReadResult result, DateTimeOffset now)
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
            // M3: an aircraft a lookup found that the whole circle sees now is the circle's; the others stay with their
            // flight until they are forgotten.
            _circle = aircraft;
            foreach (var plane in aircraft) _found.Remove(plane.Hex);
            ForgetFound(now);
            AirTrafficAircraft[] everyOne = _found.Count == 0
                ? aircraft
                : [.. aircraft, .. _found.Values.Select(item => item.Aircraft)];
            state = state with
            {
                LastReadFailed = false,
                LastFailureReason = null,
                LastSuccess = new Sighting(result.ObservedAt ?? now, result.Source ?? _provider.Attribution,
                    [.. everyOne.Select(item => new AirPictureAircraft(item, _trails.Short(item.Hex)))],
                    [.. everyOne.Select(item => new AirPictureAircraft(item, []))], FoundFlights()),
            };
        }
        else
        {
            _trails.Prune(now);
            wait = AirTrafficBackOff.Next(result.Outcome, ++_failures, result.RetryAfter, _settings.Interval);
            if (!Equals(_provider.Attribution, result.Source))
            {
                // Another network of the list took over after this failure: it is asked at the normal pace, and its own
                // failures are counted from the start. The wait the failed network asked for (a 429's Retry-After) stays
                // with the list, which asks it again neither in a retry nor in a hand-over before that wait ends (ADR-0042).
                wait = _settings.Interval;
                _failures = 0;
            }
            state = state with { LastReadFailed = true, LastFailureReason = AirPictureReasons.Of(result.Outcome) };
        }
        Volatile.Write(ref _state, state with { LastReadAt = now, NextReadAt = now + wait, CurrentWait = wait });
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
    /// The reads the scheduler sends to the network (M3): the whole circle, the airfield and approach, and the lookup of
    /// one flight by its callsign.
    /// </summary>
    private enum UpstreamRead
    {
        WholeCircle,
        Airfield,
        Callsign,
    }

    /// <summary>M3: a flight to look up: its key on the map and the ICAO callsign it is flown with.</summary>
    private sealed record LookupCandidate(string FlightKey, string Callsign);

    /// <summary>M3: an aircraft a lookup found, the flight it is and when a lookup last saw it.</summary>
    private sealed record FoundAircraft(AirTrafficAircraft Aircraft, string FlightKey, DateTimeOffset SeenAt);

    /// <summary>
    /// What the reads left, swapped whole: when the current watch started, when the last read ended and whether it failed
    /// (with its reason), when the next one is due and the wait that set it, and the last good read.
    /// </summary>
    private sealed record PictureState(DateTimeOffset? WatchStartedAt, DateTimeOffset? LastReadAt, bool LastReadFailed,
        string? LastFailureReason, DateTimeOffset? NextReadAt, TimeSpan CurrentWait, Sighting? LastSuccess);

    /// <summary>
    /// A good read: the instant the network described, its credit, its aircraft with and without trails and (M3) the
    /// flight of each aircraft a lookup found, by address.
    /// </summary>
    private sealed record Sighting(DateTimeOffset ObservedAt, AirTrafficAttribution? Source,
        IReadOnlyList<AirPictureAircraft> WithTrails, IReadOnlyList<AirPictureAircraft> WithoutTrails,
        IReadOnlyDictionary<string, string> FoundFlights);

    private sealed record MatchKeys(IReadOnlyList<MapFlightMatchKey> Keys, DateTimeOffset LoadedAt);

    private sealed class StationMatchKeys
    {
        public Lock Gate { get; } = new();

        public MatchKeys? Keys { get; set; }

        public Task? Loading { get; set; }
    }
}
