using Elevant.Application.Finance;

namespace Elevant.Api.Finance;

/// <summary>
/// 4-N23: every hour, emails the airline once for each e-CF invoice that passed its due date with a balance, by AVIAM's
/// business day in Santo Domingo. The notice mark is an audit entry written with the email in one transaction, so a
/// missed run catches up and several API hosts never repeat a notice.
/// </summary>
internal sealed partial class InvoiceOverdueNoticeWorker(
    IServiceScopeFactory scopeFactory, TimeProvider timeProvider, ILogger<InvoiceOverdueNoticeWorker> logger)
    : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval, timeProvider);
        do
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var notified = await scope.ServiceProvider.GetRequiredService<IInvoiceOverdueNoticeStore>()
                    .SweepAsync(timeProvider.GetUtcNow(), InvoiceOverdueNotices.BatchSize, stoppingToken);
                if (notified > 0) LogSweep(logger, notified);
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

    [LoggerMessage(EventId = 6601, Level = LogLevel.Information,
        Message = "Overdue invoices: {Notified} airline notices queued")]
    private static partial void LogSweep(ILogger logger, int notified);

    [LoggerMessage(EventId = 6602, Level = LogLevel.Error,
        Message = "Overdue invoice sweep failed; next hourly run will retry")]
    private static partial void LogFailure(ILogger logger, Exception exception);
}
