namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// The one budget of requests to the network (M3 of the OCC map refinement, 27 November 2026): every read of the air
/// picture takes this bucket's token before it goes out, the whole circle and the airfield and approach read alike. It is
/// a token bucket of one token that comes back <see cref="TokenInterval"/> after it is taken, so the network is never
/// asked more than <see cref="RequestsPerSecond"/> times a second over any span, nor twice within 1.25 seconds, whatever
/// the reads and their configuration ask for (adsb.fi asks for one request a second at most). It never calls anything,
/// and the caller uses it under its own gate.
/// </summary>
public sealed class AirTrafficRequestBucket
{
    /// <summary>The most requests a second the network receives from every read together.</summary>
    public const double RequestsPerSecond = 0.8;

    /// <summary>The time the token takes to come back: a second divided by <see cref="RequestsPerSecond"/>, 1.25 s.</summary>
    public static TimeSpan TokenInterval { get; } = TimeSpan.FromTicks((long)(TimeSpan.TicksPerSecond / RequestsPerSecond));

    private DateTimeOffset? _takenAt;

    /// <summary>
    /// The time left at <paramref name="now"/> before the token is back; zero while the bucket holds it. A clock set back
    /// never holds the requests: the token then counts as back.
    /// </summary>
    public TimeSpan WaitAt(DateTimeOffset now) =>
        _takenAt is { } taken && now >= taken && now - taken < TokenInterval ? TokenInterval - (now - taken) : TimeSpan.Zero;

    /// <summary>
    /// Takes the token for a request that goes out at <paramref name="now"/>. False, and nothing taken, while the token is
    /// not back.
    /// </summary>
    public bool TryTake(DateTimeOffset now)
    {
        if (WaitAt(now) > TimeSpan.Zero) return false;
        _takenAt = now;
        return true;
    }
}
