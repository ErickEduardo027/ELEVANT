using Elevant.Application.Operations.AirPicture;

namespace Elevant.Api.Integration;

/// <summary>
/// Reads the live aircraft of the OCC map (ADR-0042, contracts 1.3), and only while someone watches it: it sleeps until a
/// screen reads the map, then asks <see cref="AirPictureService"/> for one read and waits the delay it answers (the
/// interval, or the back-off after a refusal or a failure) for as long as the demand lasts. Without demand it makes no
/// call at all, so an API image certified without network never calls out; where <c>AirTraffic</c> is off it returns at
/// once. A pass that fails unexpectedly is logged once per streak and waited out: never a loop.
/// </summary>
internal sealed partial class AirTrafficPollWorker(
    AirPictureService service, TimeProvider timeProvider, ILogger<AirTrafficPollWorker> logger) : BackgroundService
{
    /// <summary>The wait after a pass that failed unexpectedly.</summary>
    internal static readonly TimeSpan FailureWait = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!service.IsEnabled)
        {
            LogDisabled(logger);
            return;
        }
        var failing = false;
        var watched = false;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!service.HasDemand)
                {
                    watched = false;
                    await service.WaitForDemandAsync(stoppingToken);
                }
                // One entry per watch: the reads start, and go on until nobody has read the map for a while.
                if (!watched)
                {
                    watched = true;
                    LogWatched(logger);
                }
                var delay = await service.PollOnceAsync(stoppingToken);
                if (failing)
                {
                    failing = false;
                    LogRecovered(logger);
                }
                await Task.Delay(delay, timeProvider, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                // One entry per streak; the next passes retry silently, each after the same wait.
                if (!failing) LogFailure(logger, exception);
                failing = true;
                try
                {
                    await Task.Delay(FailureWait, timeProvider, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
            }
        }
    }

    [LoggerMessage(EventId = 6421, Level = LogLevel.Information,
        Message = "Air traffic is off in this environment; the air picture is never read")]
    private static partial void LogDisabled(ILogger logger);

    [LoggerMessage(EventId = 6422, Level = LogLevel.Error,
        Message = "An air traffic pass failed; every pass retries after a minute and nothing more is logged until it recovers")]
    private static partial void LogFailure(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 6423, Level = LogLevel.Information, Message = "Air traffic passes recovered")]
    private static partial void LogRecovered(ILogger logger);

    [LoggerMessage(EventId = 6424, Level = LogLevel.Information,
        Message = "The OCC map is being watched; air traffic is read until nobody has watched it for a while")]
    private static partial void LogWatched(ILogger logger);
}
