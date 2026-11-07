using System.Net.Mail;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// Email outbox (ADR-0022). Claiming a message leases it for <see cref="Lease"/> so two dispatchers
/// never send it twice; failures retry with growing delays up to <see cref="MaximumAttempts"/>.
/// Bodies are cleared once the message is sent, abandoned or discarded, so codes and links do not
/// linger. A pending link or code that expires, or that a newer one replaces, is discarded instead
/// of sent late (1-N09).
/// </summary>
internal sealed class EfEmailOutboxStore(ElevantDbContext context, Application.Abstractions.Identity.IActorContextResolver actors,
    TimeProvider timeProvider) : IEmailOutboxStore
{
    public const int MaximumAttempts = 5;
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);

    private const string AccountKind = "account";

    internal static void Add(ElevantDbContext context, EmailMessage message, EmailPurpose purpose, DateTimeOffset now,
        string? attachmentReference = null) =>
        context.Set<EmailOutboxMessage>().Add(new EmailOutboxMessage
        {
            PublicId = Guid.CreateVersion7(), Recipient = message.To, Subject = message.Subject,
            HtmlBody = message.HtmlBody, TextBody = message.TextBody, Purpose = purpose,
            AttachmentReference = attachmentReference,
            Status = EmailDeliveryStatus.Pending, NextAttemptAt = now, CreatedAt = now, UpdatedAt = now,
        });

    /// <summary>
    /// Discards the pending emails of <paramref name="purpose"/> to <paramref name="recipient"/>, inside
    /// the caller's unit of work: a newer link or code replaced them, or the invitation closed (1-N09,
    /// 1-N12). Call it before queuing the replacement; the caller's SaveChanges persists both.
    /// </summary>
    internal static async Task<int> DiscardPendingAsync(ElevantDbContext context, string recipient, EmailPurpose purpose,
        string reason, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var pending = await context.Set<EmailOutboxMessage>()
            .Where(item => item.Recipient == recipient && item.Purpose == purpose &&
                item.Status == EmailDeliveryStatus.Pending)
            .ToListAsync(cancellationToken);
        foreach (var message in pending)
        {
            message.Status = EmailDeliveryStatus.Discarded;
            message.LastError = reason;
            message.HtmlBody = null;
            message.TextBody = null;
            if (message.Purpose == EmailPurpose.LoginCode) message.Subject = AccountEmailTemplates.LoginCodeSubject;
            message.UpdatedAt = now;
        }
        return pending.Count;
    }

    public async Task<IReadOnlyList<OutboxEmail>> ClaimDueAsync(int maximum, CancellationToken cancellationToken = default)
    {
        // A link or code past its lifetime is discarded, never sent late.
        await DiscardExpiredAsync(false, cancellationToken);
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
                .SetProperty(item => item.Subject, item => item.Purpose == EmailPurpose.LoginCode
                    ? AccountEmailTemplates.LoginCodeSubject : item.Subject)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
    }

    public async Task MarkFailedAsync(long id, string reason, CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        var attempts = await context.Set<EmailOutboxMessage>().AsNoTracking().Where(item => item.Id == id)
            .Select(item => item.Attempts).SingleOrDefaultAsync(cancellationToken);
        // Only codes are stored, never the provider's text; a message discarded meanwhile stays discarded.
        var error = EmailDeliveryReasons.Normalize(reason) ?? EmailDeliveryReasons.SendFailed;
        var pending = context.Set<EmailOutboxMessage>()
            .Where(item => item.Id == id && item.Status == EmailDeliveryStatus.Pending);
        if (attempts >= MaximumAttempts)
            await pending.ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, EmailDeliveryStatus.Failed)
                .SetProperty(item => item.LastError, error)
                .SetProperty(item => item.HtmlBody, (string?)null).SetProperty(item => item.TextBody, (string?)null)
                .SetProperty(item => item.Subject, item => item.Purpose == EmailPurpose.LoginCode
                    ? AccountEmailTemplates.LoginCodeSubject : item.Subject)
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        else
            await pending.ExecuteUpdateAsync(update => update.SetProperty(item => item.LastError, error)
                .SetProperty(item => item.NextAttemptAt, now + TimeSpan.FromMinutes(attempts * attempts))
                .SetProperty(item => item.UpdatedAt, now), cancellationToken);
    }

    public async Task<int> DiscardExpiredAsync(bool scrubHistory, CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        var discarded = 0;
        foreach (var (purpose, lifetime) in EmailOutboxLifetimes.Expiring)
        {
            var cutoff = now - lifetime;
            discarded += await context.Set<EmailOutboxMessage>()
                .Where(item => item.Status == EmailDeliveryStatus.Pending && item.Purpose == purpose &&
                    item.CreatedAt <= cutoff)
                .ExecuteUpdateAsync(update =>
                {
                    update.SetProperty(item => item.Status, EmailDeliveryStatus.Discarded)
                        .SetProperty(item => item.LastError, EmailDeliveryReasons.Expired)
                        .SetProperty(item => item.HtmlBody, (string?)null)
                        .SetProperty(item => item.TextBody, (string?)null)
                        .SetProperty(item => item.UpdatedAt, now);
                    if (purpose == EmailPurpose.LoginCode)
                        update.SetProperty(item => item.Subject, AccountEmailTemplates.LoginCodeSubject);
                }, cancellationToken);
        }
        // Login codes once travelled in the subject, which outlives the body; they leave it.
        if (scrubHistory)
            await context.Set<EmailOutboxMessage>()
                .Where(item => item.Purpose == EmailPurpose.LoginCode && item.Subject != AccountEmailTemplates.LoginCodeSubject)
                .ExecuteUpdateAsync(update => update.SetProperty(item => item.Subject, AccountEmailTemplates.LoginCodeSubject)
                    .SetProperty(item => item.UpdatedAt, now), cancellationToken);
        return discarded;
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
        var rows = await context.Set<EmailOutboxMessage>().AsNoTracking().OrderByDescending(item => item.Id)
            .Take(Math.Clamp(limit, 1, 100))
            .Select(item => new EmailDeliveryData(item.PublicId, item.Recipient, item.Purpose.ToString(),
                item.Status.ToString(), item.Attempts, item.CreatedAt, item.SentAt, item.LastError))
            .ToArrayAsync(cancellationToken);
        // Older rows kept the provider's text; every answer carries the normalized code only.
        return rows.Select(row => row with { LastError = EmailDeliveryReasons.Normalize(row.LastError) }).ToArray();
    }

    public async Task<EmailOutboxPageData?> ListOutboxAsync(Guid actorId, EmailOutboxQuery query,
        CancellationToken cancellationToken = default)
    {
        if (!query.IsValid || !await IsSuperAdministratorAsync(actorId, cancellationToken)) return null;
        var source = context.Set<EmailOutboxMessage>().AsNoTracking();
        if (query.Status != EmailOutboxQuery.All)
        {
            var status = Enum.Parse<EmailDeliveryStatus>(query.Status);
            source = source.Where(item => item.Status == status);
        }
        var rows = await source.OrderByDescending(item => item.Id)
            .Skip((query.Page - 1) * query.Limit).Take(query.Limit + 1)
            .Select(item => new OutboxRow(item.PublicId, item.Recipient, item.Purpose, item.Status, item.Attempts,
                item.CreatedAt, item.SentAt, item.UpdatedAt, item.LastError, item.AttachmentReference))
            .ToListAsync(cancellationToken);
        var hasMore = rows.Count > query.Limit;
        if (hasMore) rows.RemoveAt(rows.Count - 1);
        var references = await ReferencesAsync(rows, cancellationToken);
        return new EmailOutboxPageData(query.Page, query.Limit, hasMore, rows.Select(row => new EmailOutboxEntryData(
            row.Id, row.Recipient, row.Purpose.ToString(), row.Status.ToString(), row.Attempts, row.CreatedAt, row.SentAt,
            row.UpdatedAt, row.Status is EmailDeliveryStatus.Sent ? null : EmailDeliveryReasons.Normalize(row.LastError),
            references.GetValueOrDefault(row.Id))).ToArray());
    }

    private sealed record OutboxRow(Guid Id, string Recipient, EmailPurpose Purpose, EmailDeliveryStatus Status,
        int Attempts, DateTimeOffset CreatedAt, DateTimeOffset? SentAt, DateTimeOffset UpdatedAt, string? LastError,
        string? AttachmentReference);

    /// <summary>
    /// The document or account each email is about: the contract, invoice or payment of its
    /// attachment; the portal account of an account email or of an airline notice; the request of a decision.
    /// </summary>
    private async Task<Dictionary<Guid, EmailReferenceData>> ReferencesAsync(IReadOnlyList<OutboxRow> rows,
        CancellationToken cancellationToken)
    {
        var references = new Dictionary<Guid, EmailReferenceData>();
        Guid[] Attached(string prefix) => rows
            .Select(row => row.AttachmentReference is { } reference && reference.StartsWith(prefix, StringComparison.Ordinal) &&
                Guid.TryParse(reference[prefix.Length..], out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty).Distinct().ToArray();
        void Link(string prefix, IReadOnlyDictionary<Guid, EmailReferenceData> found)
        {
            foreach (var row in rows)
                if (row.AttachmentReference is { } reference && reference.StartsWith(prefix, StringComparison.Ordinal) &&
                    Guid.TryParse(reference[prefix.Length..], out var id) && found.TryGetValue(id, out var data))
                    references[row.Id] = data;
        }

        var versions = Attached(EfContractDocumentStore.AttachmentPrefix);
        if (versions.Length > 0)
            Link(EfContractDocumentStore.AttachmentPrefix, await (
                    from version in context.ContractVersions.AsNoTracking()
                    join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                    join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                    where versions.Contains(version.PublicId)
                    select new { version.PublicId, ContractId = contract.PublicId, contract.ContractCode, airline.Name })
                .ToDictionaryAsync(item => item.PublicId,
                    item => new EmailReferenceData("contract", item.ContractId, item.ContractCode, item.Name),
                    cancellationToken));

        var invoices = Attached(InvoiceEmails.AttachmentPrefix);
        if (invoices.Length > 0)
            Link(InvoiceEmails.AttachmentPrefix, await (
                    from invoice in context.NonFiscalInvoices.AsNoTracking()
                    join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
                    where invoices.Contains(invoice.PublicId)
                    select new { invoice.PublicId, Code = invoice.FiscalNumber ?? invoice.Number, airline.Name })
                .ToDictionaryAsync(item => item.PublicId,
                    item => new EmailReferenceData("invoice", item.PublicId, item.Code, item.Name), cancellationToken));

        var payments = Attached(EfCardPaymentStore.AttachmentPrefix);
        if (payments.Length > 0)
            Link(EfCardPaymentStore.AttachmentPrefix, await (
                    from attempt in context.Set<CardPaymentAttempt>().AsNoTracking()
                    join invoice in context.NonFiscalInvoices.AsNoTracking() on attempt.InvoiceId equals invoice.Id
                    join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
                    where payments.Contains(attempt.PublicId)
                    select new { attempt.PublicId, InvoiceId = invoice.PublicId, Code = invoice.FiscalNumber ?? invoice.Number,
                        airline.Name })
                .ToDictionaryAsync(item => item.PublicId,
                    item => new EmailReferenceData("payment", item.InvoiceId, item.Code, item.Name), cancellationToken));

        // The airline notices of phase 2 (blocks B and E) carry no document: they read as the portal account and its
        // airline.
        var accountRows = rows.Where(row => row.Purpose is EmailPurpose.Activation or EmailPurpose.LoginCode or
            EmailPurpose.PasswordReset or EmailPurpose.ContractReadyToSign or EmailPurpose.PermitRejected or
            EmailPurpose.PermitRevoked or EmailPurpose.PermitExpiring or EmailPurpose.ContractExpiring or
            EmailPurpose.ContractSuspended or EmailPurpose.PortalUserChanged).ToArray();
        if (accountRows.Length > 0)
        {
            var emails = accountRows.Select(row => row.Recipient.Trim().ToUpperInvariant()).Distinct().ToArray();
            var accounts = await (from user in context.Users.AsNoTracking()
                                  join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                                  where emails.Contains(user.NormalizedEmail!)
                                  select new
                                  {
                                      user.NormalizedEmail, user.PublicId, person.FirstName, person.LastName,
                                      Organization = (from membership in context.OrganizationMemberships
                                                      join organization in context.Organizations
                                                          on membership.OrganizationId equals organization.Id
                                                      where membership.AccountId == user.Id &&
                                                          membership.Kind == MembershipKind.AirlineClient
                                                      orderby membership.Status, membership.Id
                                                      select organization.DisplayName).FirstOrDefault(),
                                  }).ToArrayAsync(cancellationToken);
            var byEmail = accounts.GroupBy(item => item.NormalizedEmail!, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            foreach (var row in accountRows)
                if (byEmail.TryGetValue(row.Recipient.Trim().ToUpperInvariant(), out var account))
                    references[row.Id] = new EmailReferenceData(AccountKind, account.PublicId,
                        $"{account.FirstName} {account.LastName}".Trim(), account.Organization);
        }

        var decisionRows = rows.Where(row => row.Purpose == EmailPurpose.CommercialDecision).ToArray();
        if (decisionRows.Length > 0)
        {
            var recipients = decisionRows.Select(row => row.Recipient).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
            var requests = await context.ServiceRequests.AsNoTracking()
                .Where(request => recipients.Contains(request.ContactEmail) && request.ReviewedAt != null)
                .Select(request => new { request.PublicId, request.ContactEmail, request.RequestCode,
                    request.RequestedAirlineName, ReviewedAt = request.ReviewedAt!.Value })
                .ToArrayAsync(cancellationToken);
            // The decision email is queued in the transaction that stamps ReviewedAt.
            foreach (var row in decisionRows)
                if (requests.Where(request => string.Equals(request.ContactEmail, row.Recipient, StringComparison.OrdinalIgnoreCase) &&
                            request.ReviewedAt <= row.CreatedAt)
                        .OrderByDescending(request => request.ReviewedAt).FirstOrDefault() is { } request)
                    references[row.Id] = new EmailReferenceData("request", request.PublicId, request.RequestCode,
                        request.RequestedAirlineName);
        }
        return references;
    }

    private async Task<bool> IsSuperAdministratorAsync(Guid actorId, CancellationToken cancellationToken) =>
        (await actors.ResolveAsync(actorId, cancellationToken))?.EffectiveAccess?.IsSuperAdministrator == true;

    private static bool ValidEmail(string? email) =>
        !string.IsNullOrWhiteSpace(email) && email.Trim().Length <= 256 &&
        MailAddress.TryCreate(email.Trim(), out var address) &&
        string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
}
