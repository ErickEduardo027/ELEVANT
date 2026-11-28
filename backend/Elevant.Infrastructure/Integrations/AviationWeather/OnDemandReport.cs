using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// What one read of a weather service brought: a report or none (both succeed), or a failure with the wait its
/// <c>Retry-After</c> asked for and whether the service asked to slow down (HTTP 429).
/// </summary>
internal readonly record struct ReportAnswer<T>(bool Succeeded, T? Report, TimeSpan? RetryAfter, bool RateLimited)
    where T : class
{
    public static ReportAnswer<T> NoReport => new(true, null, null, false);

    public static ReportAnswer<T> Of(T? report) => new(true, report, null, false);

    public static ReportAnswer<T> Failure(TimeSpan? retryAfter = null, bool rateLimited = false) =>
        new(false, null, retryAfter, rateLimited);
}

/// <summary>
/// What a caller is served of one report: the report (null when there is none it may still be served),
/// whether it is the one kept after a failure, when the service last answered (null before it ever did), how the last
/// read failed (null after one that succeeded) and, while the failure is waited out, when the service is asked again.
/// </summary>
internal readonly record struct ServedReport<T>(T? Report, bool KeptAfterFailure, DateTimeOffset? RetrievedAt,
    WeatherServiceFailure? LastFailure, DateTimeOffset? RetryAt) where T : class;

/// <summary>
/// One report of a weather service, read only when someone asks for it (ADR-0043, contracts 1.4; reused by plan M6):
/// <list type="bullet">
/// <item>The last answer is served from memory for <c>lifetime</c>; after that the next caller starts one read and every
/// other caller waits for that same read. A caller that gives up stops waiting, and the read goes on for the others.</item>
/// <item>A read that fails is waited out (<see cref="AviationWeatherBackOff"/>) before the service is asked again, never
/// in a loop. Meanwhile the report kept is served, marked, up to <c>staleLimit</c> after it was read.</item>
/// <item>A report <c>servable</c> refuses (a TAF past its validity) is never served.</item>
/// </list>
/// Every member state is used under one lock; the read itself runs outside it.
/// </summary>
internal sealed class OnDemandReport<T>(TimeSpan lifetime, TimeSpan staleLimit, Func<T, DateTimeOffset, bool> servable)
    where T : class
{
    private readonly Lock _gate = new();
    private T? _report;
    private DateTimeOffset? _retrievedAt;
    private int _failures;
    private WeatherServiceFailure? _lastFailure;
    private DateTimeOffset? _nextAttemptAt;
    private TaskCompletionSource? _inFlight;

    /// <summary>
    /// The report as it may be served now: from memory while it is current or while a failure is waited out; otherwise
    /// after the one read <paramref name="ask"/> sends for every caller, without the caller's cancellation. Only that
    /// cancellation is thrown, and a fault of <paramref name="ask"/> itself (never a failure of the service).
    /// </summary>
    public async Task<ServedReport<T>> ServeAsync(Func<Task<ReportAnswer<T>>> ask, TimeProvider time,
        CancellationToken cancellationToken)
    {
        TaskCompletionSource? started = null;
        Task read;
        lock (_gate)
        {
            var now = time.GetUtcNow();
            if (IsCurrent(now) || IsWaiting(now)) return Serve(now);
            if (_inFlight is null)
            {
                started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                _inFlight = started;
            }
            read = _inFlight.Task;
        }
        // Started outside the lock, so a read that ends at once never finds its own report locked.
        if (started is not null) _ = RefreshAsync(ask, time, started);
        await read.WaitAsync(cancellationToken);
        lock (_gate) return Serve(time.GetUtcNow());
    }

    /// <summary>
    /// The one read every caller waits for. It is sent without any caller's cancellation (the client's own limit ends
    /// it) and records its outcome before it lets the callers go. It never throws: a failure of the service is an
    /// outcome, and a fault of this code reaches the callers through <paramref name="read"/>.
    /// </summary>
    private async Task RefreshAsync(Func<Task<ReportAnswer<T>>> ask, TimeProvider time, TaskCompletionSource read)
    {
        var answer = ReportAnswer<T>.Failure();
        Exception? fault = null;
        try
        {
            answer = await ask();
        }
        catch (Exception exception)
        {
            // Not an answer of the service: the callers get it, and the report waits as after a failure.
            fault = exception;
        }
        lock (_gate)
        {
            Record(answer, time.GetUtcNow());
            _inFlight = null;
        }
        if (fault is null) read.TrySetResult();
        else read.TrySetException(fault);
    }

    /// <summary>
    /// Whether the last read was answered less than <c>lifetime</c> ago. A clock set back never keeps an answer current:
    /// it is read again.
    /// </summary>
    private bool IsCurrent(DateTimeOffset now) =>
        _failures == 0 && _retrievedAt is { } at && now >= at && now - at < lifetime;

    /// <summary>Whether the wait after a failure still runs; a clock set back never stretches it beyond the longest.</summary>
    private bool IsWaiting(DateTimeOffset now) =>
        _nextAttemptAt is { } next && next > now && next - now <= AviationWeatherBackOff.MaxWait;

    private void Record(ReportAnswer<T> answer, DateTimeOffset now)
    {
        if (answer.Succeeded)
        {
            _report = answer.Report;
            _retrievedAt = now;
            _failures = 0;
            _lastFailure = null;
            _nextAttemptAt = null;
            return;
        }
        if (_failures < int.MaxValue) _failures++;
        _lastFailure = answer.RateLimited ? WeatherServiceFailure.RateLimited : WeatherServiceFailure.Failed;
        _nextAttemptAt = now + AviationWeatherBackOff.Next(_failures, answer.RetryAfter);
    }

    /// <summary>
    /// The report as it may be served now: after a failure only within its stale limit, and marked as kept; never once
    /// <c>servable</c> refuses it.
    /// </summary>
    private ServedReport<T> Serve(DateTimeOffset now)
    {
        var retryAt = _failures > 0 && IsWaiting(now) ? _nextAttemptAt : null;
        if (_report is not { } report || !servable(report, now)) return new(null, false, _retrievedAt, _lastFailure, retryAt);
        if (_failures == 0) return new(report, false, _retrievedAt, null, null);
        return _retrievedAt is { } at && now - at < staleLimit
            ? new(report, true, _retrievedAt, _lastFailure, retryAt)
            : new(null, false, _retrievedAt, _lastFailure, retryAt);
    }
}
