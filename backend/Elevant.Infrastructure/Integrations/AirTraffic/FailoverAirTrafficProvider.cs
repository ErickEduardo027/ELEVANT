using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations.AirPicture;

namespace Elevant.Infrastructure.Integrations.AirTraffic;

/// <summary>
/// The networks of <c>AirTraffic:Providers</c> in their order (ADR-0042, contracts 1.3). Each read is answered by the
/// active network: the first, until it fails three times in a row; then the next one in the list takes over (after the
/// last comes the first again). While another one is active, every ten minutes a read asks the first one before the
/// active one: when it answers, it is active again and its answer is the read's; when it does not, the active one
/// answers that same read, as if the first had not been asked. So a failed retry never reaches the caller: neither its
/// outcome nor its <c>Retry-After</c>, which only puts the next retry off when it asks for more than ten minutes. It is
/// one more request every ten minutes, never a second pace. The credit follows the active network, and every result
/// carries the credit of the network whose read it is.
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
            retryFirst = active != 0 && now >= _nextFirstTry;
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
                PutOffFirstRetry(retry.RetryAfter);
            }
        }

        var result = await _chain[active].ReadAsync(area, cancellationToken);
        lock (_gate)
        {
            // A read that began before another call changed the active network does not count.
            if (active == _active)
            {
                if (result.Outcome == AirTrafficOutcome.Succeeded) _failures = 0;
                else if (++_failures >= FailuresBeforeFailover)
                {
                    _failures = 0;
                    // A list of one network keeps asking it; the caller's back-off decides how often.
                    if (_chain.Length > 1)
                    {
                        if (_active == 0)
                        {
                            _nextFirstTry = _time.GetUtcNow() + FirstProviderRetry;
                            PutOffFirstRetry(result.RetryAfter);
                        }
                        _active = (_active + 1) % _chain.Length;
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
    /// The first network asked to wait (<c>Retry-After</c>): it is not asked again before that, even when the ten minutes
    /// end sooner, and never more than <see cref="AirTrafficBackOff.MaxWait"/> later. Called under the gate.
    /// </summary>
    private void PutOffFirstRetry(TimeSpan? retryAfter)
    {
        if (retryAfter is not { } wait) return;
        var notBefore = _time.GetUtcNow() + (wait < AirTrafficBackOff.MaxWait ? wait : AirTrafficBackOff.MaxWait);
        if (notBefore > _nextFirstTry) _nextFirstTry = notBefore;
    }
}
