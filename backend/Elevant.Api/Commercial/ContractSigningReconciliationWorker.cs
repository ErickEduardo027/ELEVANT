using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Api.Commercial;

internal sealed class ContractSigningReconciliationWorker(
    IServiceScopeFactory scopes, ILogger<ContractSigningReconciliationWorker> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<IContractSigningStore>()
                    .ReconcileDueAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch
            {
                logger.LogWarning("Contract signing reconciliation failed; retrying on next cycle.");
            }
            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }
}
