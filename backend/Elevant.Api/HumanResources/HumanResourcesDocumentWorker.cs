using Elevant.Application.Abstractions.Identity;

namespace Elevant.Api.HumanResources;

/// <summary>
/// Sweeps ramp agents' documents every hour (2-N25): Gestión Humana is told, once per cycle, that a current airport
/// permit, ramp licence or qualification expires within <c>HumanResources:DocumentExpiryNoticeDays</c>, and OCC that
/// an assigned operation falls after the end of its agent's current document. No email is sent and nothing is
/// released; each notice is idempotent, so a missed run catches up.
/// </summary>
internal sealed partial class HumanResourcesDocumentWorker(
    IServiceScopeFactory scopeFactory, ILogger<HumanResourcesDocumentWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var sweep = await scope.ServiceProvider.GetRequiredService<IHumanResourcesDocumentSweepStore>()
                    .SweepAsync(stoppingToken);
                if (sweep.ExpiryNotices + sweep.AssignmentNotices > 0)
                    LogSweep(logger, sweep.ExpiryNotices, sweep.AssignmentNotices);
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

    [LoggerMessage(EventId = 6501, Level = LogLevel.Information,
        Message = "Ramp agent documents: {ExpiryNotices} expiry notices to Human Resources, {AssignmentNotices} uncovered assignments announced to OCC")]
    private static partial void LogSweep(ILogger logger, int expiryNotices, int assignmentNotices);

    [LoggerMessage(EventId = 6502, Level = LogLevel.Error,
        Message = "Ramp agent document sweep failed; next hourly run will retry")]
    private static partial void LogFailure(ILogger logger, Exception exception);
}
