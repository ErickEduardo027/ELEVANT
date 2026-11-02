using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Api.Commercial;

/// <summary>
/// Applies the dated contract rules every hour (ADR-0024): activates signed contracts with a
/// usable permit, expires contracts past their validity, suspends on an expired operating permit
/// and sends the 30-day notices once. Each rule is idempotent, so a missed run catches up.
/// </summary>
internal sealed partial class ContractLifecycleWorker(
    IServiceScopeFactory scopeFactory, ILogger<ContractLifecycleWorker> logger) : BackgroundService
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
                var sweep = await scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>().SweepAsync(stoppingToken);
                if (sweep.Activated + sweep.Expired + sweep.Suspended + sweep.PermitNotices + sweep.ContractNotices > 0)
                    LogSweep(logger, sweep.Activated, sweep.Expired, sweep.Suspended, sweep.PermitNotices, sweep.ContractNotices);
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

    [LoggerMessage(EventId = 6301, Level = LogLevel.Information,
        Message = "Contract lifecycle: {Activated} activated, {Expired} expired, {Suspended} suspended, {PermitNotices} permit and {ContractNotices} contract notices")]
    private static partial void LogSweep(ILogger logger, int activated, int expired, int suspended, int permitNotices, int contractNotices);

    [LoggerMessage(EventId = 6302, Level = LogLevel.Error, Message = "Contract lifecycle sweep failed; next hourly run will retry")]
    private static partial void LogFailure(ILogger logger, Exception exception);
}
