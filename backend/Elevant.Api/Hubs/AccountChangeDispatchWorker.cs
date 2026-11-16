using Elevant.Application.Abstractions.Realtime;
using Microsoft.AspNetCore.SignalR;

namespace Elevant.Api.Hubs;

internal interface IAccountChangePush
{
    Task SendAsync(AccountChangeDispatchNotice notice,
        CancellationToken cancellationToken = default);
}

/// <summary>Signals a changed cursor without sending the resource or its content.</summary>
internal sealed class SignalRAccountChangePush(
    IHubContext<OperationsHub> operationsHub,
    IHubContext<NotificationsHub> notificationsHub) : IAccountChangePush
{
    public Task SendAsync(AccountChangeDispatchNotice notice,
        CancellationToken cancellationToken = default)
    {
        var userId = notice.AccountPublicId.ToString("D");
        var payload = new { eventId = notice.EventId };
        return notice.Resource == "notifications"
            ? notificationsHub.Clients.User(userId)
                .SendAsync("ChangedV1", payload, cancellationToken)
            : operationsHub.Clients.User(userId)
                .SendAsync("ChangedV1", payload, cancellationToken);
    }
}

/// <summary>Projects the SQL outbox before any best-effort SignalR notification.</summary>
internal sealed partial class AccountChangeDispatchWorker(
    IServiceScopeFactory scopeFactory,
    IAccountChangePush push,
    ILogger<AccountChangeDispatchWorker> logger) : BackgroundService
{
    private const int BatchSize = 50;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(2);

    internal async Task<int> DispatchOnceAsync(int limit, CancellationToken cancellationToken)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IAccountChangeDispatcherStore>();
        var notices = await store.DispatchPendingAsync(limit, cancellationToken);
        foreach (var notice in notices)
        {
            try
            {
                await push.SendAsync(notice, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                // The committed HTTP feed, not a WebSocket send, is the delivery guarantee.
                LogPushFailure(logger, exception, notice.EventId);
            }
        }

        return notices.Count;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await DispatchOnceAsync(BatchSize, stoppingToken) == BatchSize)
                    continue;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                LogDispatchFailure(logger, exception);
            }

            try
            {
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    [LoggerMessage(EventId = 5201, Level = LogLevel.Warning,
        Message = "Account change push failed for event {EventId}; clients must reconcile the feed")]
    private static partial void LogPushFailure(ILogger logger, Exception exception, Guid eventId);

    [LoggerMessage(EventId = 5202, Level = LogLevel.Error,
        Message = "Account change dispatch failed; retrying after the poll interval")]
    private static partial void LogDispatchFailure(ILogger logger, Exception exception);
}
