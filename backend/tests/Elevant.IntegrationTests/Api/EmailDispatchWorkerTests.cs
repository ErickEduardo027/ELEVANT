using Elevant.Api.Messaging;
using Elevant.Application.Abstractions.Messaging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// 1-N09 and 1-N22: the dispatcher discards expired links and codes also without SMTP, and a failed send
/// stores its normalized reason, never the provider's text.
/// </summary>
public sealed class EmailDispatchWorkerTests
{
    [Fact]
    public async Task WithoutSmtpItStillDiscardsExpiredEmailsAndSendsNothing()
    {
        var outbox = new OutboxStub();
        using var worker = Worker(outbox, new SenderStub(configured: false));
        await worker.StartAsync(TestContext.Current.CancellationToken);
        Assert.True(await outbox.Discarded.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
        await worker.StopAsync(TestContext.Current.CancellationToken);
        Assert.Equal(0, outbox.Claims);
    }

    [Fact]
    public async Task AFailedSendKeepsOnlyItsNormalizedReason()
    {
        var outbox = new OutboxStub
        {
            Due = [new OutboxEmail(1, "ana@example.test", "Asunto", "<p>x</p>", "x"),
                new OutboxEmail(2, "ana@example.test", "Factura", "<p>x</p>", "x", "invoice:missing")],
        };
        using var worker = Worker(outbox, new SenderStub(configured: true));
        await worker.StartAsync(TestContext.Current.CancellationToken);
        await outbox.AllFailed.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        await worker.StopAsync(TestContext.Current.CancellationToken);
        Assert.Equal(new[] { (1L, EmailDeliveryReasons.SmtpRejected), (2L, EmailDeliveryReasons.AttachmentUnavailable) },
            outbox.Failures.OrderBy(item => item.Id).ToArray());
        Assert.Equal(0, outbox.Sent);
    }

    private static EmailDispatchWorker Worker(OutboxStub outbox, SenderStub sender)
    {
        var services = new ServiceCollection()
            .AddSingleton<IEmailOutboxStore>(outbox)
            .AddSingleton<IEmailAttachmentResolver>(new MissingAttachments())
            .BuildServiceProvider();
        return new EmailDispatchWorker(services.GetRequiredService<IServiceScopeFactory>(), sender,
            NullLogger<EmailDispatchWorker>.Instance);
    }

    private sealed class SenderStub(bool configured) : IEmailSender
    {
        public bool IsConfigured => configured;

        public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default) =>
            throw EmailSendException.For(EmailDeliveryReasons.SmtpRejected,
                new InvalidOperationException("550 5.1.1 The email account that you tried to reach does not exist."));
    }

    private sealed class MissingAttachments : IEmailAttachmentResolver
    {
        public Task<EmailAttachment?> ResolveAsync(string reference, CancellationToken cancellationToken = default) =>
            Task.FromResult<EmailAttachment?>(null);
    }

    private sealed class OutboxStub : IEmailOutboxStore
    {
        private readonly object gate = new();

        public IReadOnlyList<OutboxEmail> Due { get; init; } = [];

        public int Claims { get; private set; }

        public int Sent { get; private set; }

        public List<(long Id, string Reason)> Failures { get; } = [];

        public TaskCompletionSource<bool> Discarded { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource AllFailed { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<IReadOnlyList<OutboxEmail>> ClaimDueAsync(int maximum, CancellationToken cancellationToken = default)
        {
            lock (gate)
            {
                Claims++;
                return Task.FromResult<IReadOnlyList<OutboxEmail>>(Claims == 1 ? Due : []);
            }
        }

        public Task MarkSentAsync(long id, CancellationToken cancellationToken = default)
        {
            lock (gate) Sent++;
            return Task.CompletedTask;
        }

        public Task MarkFailedAsync(long id, string reason, CancellationToken cancellationToken = default)
        {
            lock (gate)
            {
                Failures.Add((id, reason));
                if (Failures.Count == Due.Count) AllFailed.TrySetResult();
            }
            return Task.CompletedTask;
        }

        public Task<int> DiscardExpiredAsync(bool scrubHistory, CancellationToken cancellationToken = default)
        {
            // The first run also scrubs the codes older subjects carry.
            Discarded.TrySetResult(scrubHistory);
            return Task.FromResult(0);
        }

        public Task<Guid?> EnqueueTestAsync(Guid actorId, string recipient, CancellationToken cancellationToken = default) =>
            Task.FromResult<Guid?>(null);

        public Task<IReadOnlyList<EmailDeliveryData>?> ListRecentAsync(Guid actorId, int limit,
            CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<EmailDeliveryData>?>(null);

        public Task<EmailOutboxPageData?> ListOutboxAsync(Guid actorId, EmailOutboxQuery query,
            CancellationToken cancellationToken = default) => Task.FromResult<EmailOutboxPageData?>(null);
    }
}
