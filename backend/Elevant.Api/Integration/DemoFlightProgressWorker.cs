using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Integration.DemoFlights;

namespace Elevant.Api.Integration;

/// <summary>
/// Advances the demo flights every five seconds (ADR-0041): after OCC imported a flight it marks the landing and the
/// take-off as the paid feed would, and it dismisses a pair nobody imported once its aircraft is gone. Where
/// <c>DemoFlights:Mode</c> is off it does nothing at all. A failed pass (no database, a deadlock) is retried by the next
/// tick and logged once per streak of failures, so an API image certified without a database neither stops nor floods
/// its log.
/// </summary>
internal sealed partial class DemoFlightProgressWorker(
    IServiceScopeFactory scopeFactory, DemoFlightAvailability availability, TimeProvider timeProvider,
    ILogger<DemoFlightProgressWorker> logger) : BackgroundService
{
    internal static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!availability.Enabled)
        {
            LogDisabled(logger);
            return;
        }
        using var timer = new PeriodicTimer(Interval, timeProvider);
        var failing = false;
        do
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var changed = await scope.ServiceProvider.GetRequiredService<IDemoFlightStore>()
                    .AdvanceAsync(timeProvider.GetUtcNow(), stoppingToken);
                if (failing)
                {
                    failing = false;
                    LogRecovered(logger);
                }
                if (changed > 0) LogAdvanced(logger, changed);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                // One entry per streak: the next ticks retry silently until a pass succeeds.
                if (!failing) LogFailure(logger, exception);
                failing = true;
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    [LoggerMessage(EventId = 6411, Level = LogLevel.Information,
        Message = "Demo flights are off in this environment; the progress worker does not run")]
    private static partial void LogDisabled(ILogger logger);

    [LoggerMessage(EventId = 6412, Level = LogLevel.Error,
        Message = "Demo flight progress failed; every tick retries and nothing more is logged until it recovers")]
    private static partial void LogFailure(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 6413, Level = LogLevel.Information, Message = "Demo flight progress recovered")]
    private static partial void LogRecovered(ILogger logger);

    [LoggerMessage(EventId = 6414, Level = LogLevel.Information, Message = "Demo flights: {Changed} flight(s) advanced")]
    private static partial void LogAdvanced(ILogger logger, int changed);
}
