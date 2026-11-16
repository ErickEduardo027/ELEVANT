using Elevant.Application.Abstractions.Messaging;

namespace Elevant.Api.Messaging;

/// <summary>
/// Drains the email outbox (ADR-0022). Without SMTP settings it sends nothing and messages stay
/// pending, so the UI never claims an email went out; even then it discards the links and codes
/// that expire in the queue (1-N09). Failures store a normalized reason, never bodies or the
/// provider's text.
/// </summary>
internal sealed partial class EmailDispatchWorker(
    IServiceScopeFactory scopeFactory, IEmailSender sender, ILogger<EmailDispatchWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan IdleInterval = TimeSpan.FromMinutes(1);
    private const int BatchSize = 20;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!sender.IsConfigured) LogDisabled(logger);
        using var timer = new PeriodicTimer(sender.IsConfigured ? Interval : IdleInterval);
        // The first successful run also removes the login codes that older subjects still carry.
        var scrubHistory = true;
        do
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var outbox = scope.ServiceProvider.GetRequiredService<IEmailOutboxStore>();
                var discarded = await outbox.DiscardExpiredAsync(scrubHistory, stoppingToken);
                scrubHistory = false;
                if (discarded > 0) LogDiscarded(logger, discarded);
                if (!sender.IsConfigured) continue;
                foreach (var email in await outbox.ClaimDueAsync(BatchSize, stoppingToken))
                {
                    try
                    {
                        IReadOnlyList<EmailAttachment>? attachments = null;
                        if (email.AttachmentReference is { } reference)
                        {
                            // Resolved now, from current data; a missing file fails and retries like any send.
                            var attachment = await scope.ServiceProvider.GetRequiredService<IEmailAttachmentResolver>()
                                .ResolveAsync(reference, stoppingToken)
                                ?? throw EmailSendException.For(EmailDeliveryReasons.AttachmentUnavailable);
                            attachments = [attachment];
                        }
                        await sender.SendAsync(new EmailMessage(email.To, email.Subject, email.HtmlBody, email.TextBody,
                            attachments), stoppingToken);
                        await outbox.MarkSentAsync(email.Id, stoppingToken);
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        var reason = exception is EmailSendException send ? send.Reason : EmailDeliveryReasons.SendFailed;
                        await outbox.MarkFailedAsync(email.Id, reason, stoppingToken);
                        LogSendFailure(logger, email.Id, reason);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                LogDispatchFailure(logger, exception);
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    [LoggerMessage(EventId = 6201, Level = LogLevel.Warning,
        Message = "SMTP is not configured; portal emails stay pending in the outbox and expired ones are discarded")]
    private static partial void LogDisabled(ILogger logger);

    [LoggerMessage(EventId = 6202, Level = LogLevel.Warning,
        Message = "Email {OutboxId} could not be sent ({Reason}); it will be retried")]
    private static partial void LogSendFailure(ILogger logger, long outboxId, string reason);

    [LoggerMessage(EventId = 6203, Level = LogLevel.Error, Message = "Email dispatch failed; next run will retry")]
    private static partial void LogDispatchFailure(ILogger logger, Exception exception);

    [LoggerMessage(EventId = 6204, Level = LogLevel.Information,
        Message = "{Count} queued emails expired before they could be sent and were discarded")]
    private static partial void LogDiscarded(ILogger logger, int count);
}
