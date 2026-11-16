using Elevant.Application.Abstractions.Integrations;
using Elevant.Application.Integration;

namespace Elevant.Api.Integration;

/// <summary>
/// Runs the flight feed planner every minute (ADR-0028). Most minutes make no call: the planner
/// only reads a station when a day half is missing or its refresh interval has passed. Without a
/// configured feed it does nothing.
/// </summary>
internal sealed partial class FlightFeedSyncWorker(
    IServiceScopeFactory scopeFactory, IAirportFlightFeed feed, ILogger<FlightFeedSyncWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!feed.IsConfigured)
        {
            LogDisabled(logger, feed.Provider);
            return;
        }
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var calls = await scope.ServiceProvider.GetRequiredService<FlightFeedSynchronizer>().RunScheduledAsync(stoppingToken);
                if (calls > 0) LogCalls(logger, feed.Provider, calls);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                LogFailure(logger, exception);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    [LoggerMessage(EventId = 6401, Level = LogLevel.Information, Message = "Flight feed {Provider} is not configured; no calls are made")]
    private static partial void LogDisabled(ILogger logger, string provider);

    [LoggerMessage(EventId = 6402, Level = LogLevel.Information, Message = "Flight feed {Provider}: {Calls} call(s) this pass")]
    private static partial void LogCalls(ILogger logger, string provider, int calls);

    [LoggerMessage(EventId = 6403, Level = LogLevel.Error, Message = "Flight feed pass failed; the next pass retries within the budget")]
    private static partial void LogFailure(ILogger logger, Exception exception);
}
