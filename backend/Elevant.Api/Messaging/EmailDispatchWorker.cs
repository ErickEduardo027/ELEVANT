using Elevant.Application.Abstractions.Messaging;

namespace Elevant.Api.Messaging;

/// <summary>
/// Drains the email outbox (ADR-0022). Without SMTP settings it sends nothing and messages stay
/// pending, so the UI never claims an email went out. Failure reasons are logged without bodies.
/// </summary>
internal sealed partial class EmailDispatchWorker(
    IServiceScopeFactory scopeFactory, IEmailSender sender, ILogger<EmailDispatchWorker> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);
    private const int BatchSize = 20;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!sender.IsConfigured)
        {
            LogDisabled(logger);
            return;
        }
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var outbox = scope.ServiceProvider.GetRequiredService<IEmailOutboxStore>();
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
                                ?? throw new InvalidOperationException("The email attachment is no longer available.");
                            attachments = [attachment];
                        }
                        await sender.SendAsync(new EmailMessage(email.To, email.Subject, email.HtmlBody, email.TextBody,
                            attachments), stoppingToken);
                        await outbox.MarkSentAsync(email.Id, stoppingToken);
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        await outbox.MarkFailedAsync(email.Id, exception.GetType().Name + ": " + exception.Message, stoppingToken);
                        LogSendFailure(logger, email.Id, exception.GetType().Name);
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
        }
    }

    [LoggerMessage(EventId = 6201, Level = LogLevel.Warning,
        Message = "SMTP is not configured; portal emails stay pending in the outbox")]
    private static partial void LogDisabled(ILogger logger);

    [LoggerMessage(EventId = 6202, Level = LogLevel.Warning,
        Message = "Email {OutboxId} could not be sent ({Reason}); it will be retried")]
    private static partial void LogSendFailure(ILogger logger, long outboxId, string reason);

    [LoggerMessage(EventId = 6203, Level = LogLevel.Error, Message = "Email dispatch failed; next run will retry")]
    private static partial void LogDispatchFailure(ILogger logger, Exception exception);
}
