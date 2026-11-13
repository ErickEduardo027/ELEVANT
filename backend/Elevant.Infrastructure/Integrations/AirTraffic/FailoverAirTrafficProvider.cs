using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AirTraffic;

/// <summary>
/// The networks of <c>AirTraffic:Providers</c> in their order (ADR-0042, contracts 1.3). Each read asks exactly one of
/// them: the active one, which is the first until it fails three times in a row; then the next one in the list takes
/// over (after the last comes the first again). While another one is active, the first is asked again every ten minutes,
/// in place of the active one for that read, and becomes active again as soon as it answers. The credit follows the
/// active network, and every result carries the credit of the network that was asked.
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
        int asked;
        bool firstAgain;
        lock (_gate)
        {
            var now = _time.GetUtcNow();
            firstAgain = _active != 0 && now >= _nextFirstTry;
            if (firstAgain) _nextFirstTry = now + FirstProviderRetry;
            asked = firstAgain ? 0 : _active;
        }

        var result = await _chain[asked].ReadAsync(area, cancellationToken);

        lock (_gate)
        {
            var succeeded = result.Outcome == AirTrafficOutcome.Succeeded;
            if (firstAgain)
            {
                // A failed retry of the first network leaves the active one and its count as they were.
                if (succeeded && _active != 0)
                {
                    _active = 0;
                    _failures = 0;
                }
            }
            else if (asked == _active)
            {
                if (succeeded) _failures = 0;
                else if (++_failures >= FailuresBeforeFailover)
                {
                    _failures = 0;
                    // A list of one network keeps asking it; the caller's back-off decides how often.
                    if (_chain.Length > 1)
                    {
                        if (_active == 0) _nextFirstTry = _time.GetUtcNow() + FirstProviderRetry;
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
}
