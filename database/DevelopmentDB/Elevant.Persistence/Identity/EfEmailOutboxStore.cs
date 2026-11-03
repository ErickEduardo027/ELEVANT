using System.Net.Mail;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Email outbox (ADR-0022). Claiming a message leases it for <see cref="Lease"/> so two dispatchers
/// never send it twice; failures retry with growing delays up to <see cref="MaximumAttempts"/>.
/// Bodies are cleared once the message is sent or abandoned, so codes and links do not linger.
/// </summary>
internal sealed class EfEmailOutboxStore(ElevantDbContext context, Application.Abstractions.Identity.IActorContextResolver actors,
    TimeProvider timeProvider) : IEmailOutboxStore
{
    public const int MaximumAttempts = 5;
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);

    internal static void Add(ElevantDbContext context, EmailMessage message, EmailPurpose purpose, DateTimeOffset now,
        string? attachmentReference = null) =>
        context.Set<EmailOutboxMessage>().Add(new EmailOutboxMessage
        {
            PublicId = Guid.CreateVersion7(), Recipient = message.To, Subject = message.Subject,
            HtmlBody = message.HtmlBody, TextBody = message.TextBody, Purpose = purpose,
            AttachmentReference = attachmentReference,
            Status = EmailDeliveryStatus.Pending, NextAttemptAt = now, CreatedAt = now, UpdatedAt = now,
        });

    public async Task<IReadOnlyList<OutboxEmail>> ClaimDueAsync(int maximum, CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        var due = await context.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Status == EmailDeliveryStatus.Pending && item.NextAttemptAt <= now)
            .OrderBy(item => item.Id).Take(maximum)
            .Select(item => new { item.Id, item.Attempts }).ToArrayAsync(cancellationToken);
        var claimed = new List<OutboxEmail>();
        foreach (var candidate in due)
        {
            // Compare-and-set on the attempt counter: only one dispatcher wins each message.
            var won = await context.Set<EmailOutboxMessage>()
                .Where(item => item.Id == candidate.Id && item.Attempts == candidate.Attempts &&
                    item.Status == EmailDeliveryStatus.Pending)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Attempts, candidate.Attempts + 1)
                    .SetProperty(item => item.NextAttemptAt, now + Lease)
                    .SetProperty(item => item.UpdatedAt, now), cancellationToken);
            if (won == 0) continue;
            var message = await context.Set<EmailOutboxMessage>().AsNoTracking()
                .Where(item => item.Id == candidate.Id)
                .Select(item => new OutboxEmail(item.Id, item.Recipient, item.Subject, item.HtmlBody ?? string.Empty,
                    item.TextBody ?? string.Empty, item.AttachmentReference)).SingleAsync(cancellationToken);
            claimed.Add(message);
        }
        return claimed;
    }

    public Task MarkSentAsync(long id, CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        return context.Set<EmailOutboxMessage>().Where(item => item.Id == id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, EmailDeliveryStatus.Sent)
                .SetProperty(item => item.SentAt, now).SetProperty(item => item.LastError, (string?)null)
                .SetProperty(item => item.HtmlBody, (string?)null).SetProperty(item => item.TextBody, (string?)null)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
    }

    public async Task MarkFailedAsync(long id, string reason, CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        var attempts = await context.Set<EmailOutboxMessage>().AsNoTracking().Where(item => item.Id == id)
            .Select(item => item.Attempts).SingleOrDefaultAsync(cancellationToken);
        var error = reason.Length > 300 ? reason[..300] : reason;
        if (attempts >= MaximumAttempts)
            await context.Set<EmailOutboxMessage>().Where(item => item.Id == id)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, EmailDeliveryStatus.Failed)
                    .SetProperty(item => item.LastError, error)
                    .SetProperty(item => item.HtmlBody, (string?)null).SetProperty(item => item.TextBody, (string?)null)
                    .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        else
            await context.Set<EmailOutboxMessage>().Where(item => item.Id == id)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.LastError, error)
                    .SetProperty(item => item.NextAttemptAt, now + TimeSpan.FromMinutes(attempts * attempts))
                    .SetProperty(item => item.UpdatedAt, now), cancellationToken);
    }

    public async Task<Guid?> EnqueueTestAsync(Guid actorId, string recipient, CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken) || !ValidEmail(recipient)) return null;
        var now = timeProvider.GetUtcNow();
        Add(context, AccountEmailTemplates.Test(recipient.Trim(), now), EmailPurpose.Test, now);
        await context.SaveChangesAsync(cancellationToken);
        return await context.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.Test).OrderByDescending(item => item.Id)
            .Select(item => item.PublicId).FirstAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<EmailDeliveryData>?> ListRecentAsync(Guid actorId, int limit,
        CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return null;
        return await context.Set<EmailOutboxMessage>().AsNoTracking().OrderByDescending(item => item.Id)
            .Take(Math.Clamp(limit, 1, 100))
            .Select(item => new EmailDeliveryData(item.PublicId, item.Recipient, item.Purpose.ToString(),
                item.Status.ToString(), item.Attempts, item.CreatedAt, item.SentAt, item.LastError))
            .ToArrayAsync(cancellationToken);
    }

    private async Task<bool> IsSuperAdministratorAsync(Guid actorId, CancellationToken cancellationToken) =>
        (await actors.ResolveAsync(actorId, cancellationToken))?.EffectiveAccess?.IsSuperAdministrator == true;

    private static bool ValidEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) && email.Trim().Length <= 256 &&
        MailAddress.TryCreate(email.Trim(), out var address) &&
        string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
}
