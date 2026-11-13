using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Infrastructure.Integrations.AirTraffic;

/// <summary>
/// The networks of <c>AirTraffic:Providers</c> in their order (ADR-0042, contracts 1.3). Each read is answered by the
/// active network: the first, until it fails three times in a row; then the next one in the list takes over (after the
/// last comes the first again). While another one is active, every ten minutes a read asks the first one before the
/// active one: when it answers, it is active again and its answer is the read's; when it does not, the active one
/// answers that same read, as if the first had not been asked. So a failed retry never reaches the caller: neither its
/// outcome nor its <c>Retry-After</c>. It is one more request every ten minutes, never a second pace. A network that asked
/// to slow down (429) is not asked again before its <c>Retry-After</c> ends, at least a minute later and at most a day:
/// neither by the retry of the first nor by a hand-over. While the network that would take over still waits, the active
/// one keeps the turn, and its first failure after that wait hands over. The credit follows the active network, and
/// every result carries the credit of the network whose read it is.
/// </summary>
public sealed class FailoverAirTrafficProvider : IAirTrafficProvider, IDisposable
{
    /// <summary>Failed reads in a row of the active network before the next one takes over.</summary>
    public const int FailuresBeforeFailover = 3;

    /// <summary>How often the first network is asked again while another one is active.</summary>
    public static TimeSpan FirstProviderRetry { get; } = TimeSpan.FromMinutes(10);

    private readonly IAirTrafficProvider[] _chain;
    private readonly TimeProvider _time;
    private readonly Lock _gate = new();
    // Per network, until when its last 429 asked to wait: neither the retry of the first nor a hand-over asks it sooner.
    // The active network is asked when the caller reads, and the caller's back-off waits out its 429 itself.
    private readonly DateTimeOffset[] _notBefore;
    private int _active;
    private int _failures;
    private DateTimeOffset _nextFirstTry;

    public FailoverAirTrafficProvider(IReadOnlyList<IAirTrafficProvider> chain, TimeProvider time)
    {
        ArgumentNullException.ThrowIfNull(chain);
        ArgumentNullException.ThrowIfNull(time);
        if (chain.Count == 0 || chain.Any(provider => provider is null || !provider.IsConfigured))
            throw new ArgumentException("The chain needs at least one configured network.", nameof(chain));
        _chain = [.. chain];
        _notBefore = new DateTimeOffset[_chain.Length];
        _time = time;
    }

    public bool IsConfigured => true;

    public AirTrafficAttribution? Attribution
    {
        get
        {
            lock (_gate) return _chain[_active].Attribution;
        }
    }

    /// <summary>The networks in the order they are tried.</summary>
    internal IReadOnlyList<IAirTrafficProvider> Chain => _chain;

    public async Task<AirTrafficReadResult> ReadAsync(AirTrafficArea area, CancellationToken cancellationToken = default)
    {
        int active;
        bool retryFirst;
        lock (_gate)
        {
            var now = _time.GetUtcNow();
            active = _active;
            retryFirst = active != 0 && now >= _nextFirstTry && now >= _notBefore[0];
            // Set before the retry is sent, so the calls that arrive meanwhile ask the active network only.
            if (retryFirst) _nextFirstTry = now + FirstProviderRetry;
        }

        if (retryFirst)
        {
            var retry = await _chain[0].ReadAsync(area, cancellationToken);
            lock (_gate)
            {
                if (retry.Outcome == AirTrafficOutcome.Succeeded)
                {
                    _active = 0;
                    _failures = 0;
                    return retry;
                }
                // It still fails: the active network and its count stay as they were, and that network answers this read.
                NoteRateLimit(0, retry);
            }
        }

        var result = await _chain[active].ReadAsync(area, cancellationToken);
        lock (_gate)
        {
            NoteRateLimit(active, result);
            // A read that began before another call changed the active network does not count.
            if (active == _active)
            {
                if (result.Outcome == AirTrafficOutcome.Succeeded) _failures = 0;
                else if (++_failures >= FailuresBeforeFailover)
                {
                    if (NextAvailable(active) is { } next)
                    {
                        _failures = 0;
                        if (active == 0) _nextFirstTry = _time.GetUtcNow() + FirstProviderRetry;
                        _active = next;
                    }
                    else
                    {
                        // Nobody may take over: a list of one network, or the others still wait out a Retry-After. The
                        // active one keeps the turn, the caller's back-off decides how often it is asked, and its next
                        // failure tries the hand-over again.
                        _failures = FailuresBeforeFailover;
                    }
                }
            }
        }
        return result;
    }

    public void Dispose()
    {
        foreach (var provider in _chain) (provider as IDisposable)?.Dispose();
    }

    /// <summary>
    /// The network that takes over from <paramref name="active"/>: the next one in the list (after the last comes the
    /// first) that is not waiting out a <c>Retry-After</c>; null when there is none. Called under the gate.
    /// </summary>
    private int? NextAvailable(int active)
    {
        var now = _time.GetUtcNow();
        for (var step = 1; step < _chain.Length; step++)
        {
            var next = (active + step) % _chain.Length;
            if (now >= _notBefore[next]) return next;
        }
        return null;
    }

    /// <summary>
    /// A network asked to slow down (429): it is not asked again before what its <c>Retry-After</c> asks, at least a
    /// minute and at most a day, as <see cref="AirTrafficBackOff"/> waits after a 429. A later answer never shortens that
    /// wait. Other outcomes ask for nothing here: the first network is still retried every ten minutes after a refusal
    /// (contracts 1.3). Called under the gate.
    /// </summary>
    private void NoteRateLimit(int network, AirTrafficReadResult result)
    {
        if (result.Outcome != AirTrafficOutcome.RateLimited) return;
        var notBefore = _time.GetUtcNow() + AirTrafficBackOff.Next(AirTrafficOutcome.RateLimited, 1, result.RetryAfter,
            AirTrafficSettings.MinimumInterval);
        if (notBefore > _notBefore[network]) _notBefore[network] = notBefore;
    }
}
