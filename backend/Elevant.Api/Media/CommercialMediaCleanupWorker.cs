using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Api.Media;

/// <summary>Reclaims uploaded media that never became part of a saved record.</summary>
internal sealed partial class CommercialMediaCleanupWorker(
    IServiceScopeFactory scopeFactory, ILogger<CommercialMediaCleanupWorker> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                int removed;
                do
                {
                    await using var scope = scopeFactory.CreateAsyncScope();
                    var store = scope.ServiceProvider.GetRequiredService<ICommercialMediaStore>();
                    removed = await store.CleanupOrphansAsync(stoppingToken);
                } while (removed == 100 && !stoppingToken.IsCancellationRequested);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                LogCleanupFailure(logger, exception);
            }
        }
    }

    [LoggerMessage(EventId = 6102, Level = LogLevel.Error,
        Message = "Commercial media cleanup failed; next hourly run will retry")]
    private static partial void LogCleanupFailure(ILogger logger, Exception exception);
}
