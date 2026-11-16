using Elevant.Application.Common;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// Queues the airline's billing emails for its active portal accounts and its billing email: «Factura emitida»
/// (ADR-0035) and, from phase 4 on, the credit or debit note and the overdue invoice (4-N23). The PDF is rendered when
/// the email is sent, never stored in the outbox; no email states a balance or any card data.
/// </summary>
internal static class InvoiceEmails
{
    public const string AttachmentPrefix = "invoice:";

    /// <summary>
    /// «Factura emitida»: the total, the due date and the confirmed prepayment the issuance applied
    /// (<paramref name="prepaidApplied"/>), never the balance.
    /// </summary>
    public static async Task QueueIssuedAsync(ElevantDbContext context, NonFiscalInvoice invoice, decimal prepaidApplied,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var (airline, emails) = await RecipientsAsync(context, invoice.AirlineId, now, cancellationToken);
        foreach (var email in emails)
            EfEmailOutboxStore.Add(context,
                AccountEmailTemplates.InvoiceIssued(email, airline, invoice.FiscalNumber ?? invoice.Number,
                    invoice.CurrencyCode, invoice.Total, prepaidApplied, invoice.DueDate),
                EmailPurpose.InvoiceIssued, now, AttachmentPrefix + invoice.PublicId.ToString("D"));
    }

    /// <summary>4-N23: the credit or debit note Finance issued on the invoice, with the note's PDF.</summary>
    public static async Task QueueAdjustmentNoteAsync(ElevantDbContext context, NonFiscalInvoice invoice,
        FinanceTreasuryAdjustmentNote note, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var (airline, emails) = await RecipientsAsync(context, invoice.AirlineId, now, cancellationToken);
        foreach (var email in emails)
            EfEmailOutboxStore.Add(context,
                AccountEmailTemplates.AdjustmentNoteIssued(email, airline, note.Number,
                    note.Kind == FinanceTreasuryAdjustmentKind.Credit, invoice.FiscalNumber ?? invoice.Number,
                    note.CurrencyCode, note.Amount),
                EmailPurpose.AdjustmentNoteIssued, now, AdjustmentNoteDocuments.AttachmentPrefix + note.PublicId.ToString("D"));
    }

    /// <summary>4-N23: the one notice of an invoice past its due date, with the invoice's PDF; returns how many queued.</summary>
    public static async Task<int> QueueOverdueAsync(ElevantDbContext context, NonFiscalInvoice invoice, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (invoice.DueDate is not { } due) return 0;
        var (airline, emails) = await RecipientsAsync(context, invoice.AirlineId, now, cancellationToken);
        foreach (var email in emails)
            EfEmailOutboxStore.Add(context,
                AccountEmailTemplates.InvoiceOverdue(email, airline, invoice.FiscalNumber ?? invoice.Number, due),
                EmailPurpose.InvoiceOverdue, now, AttachmentPrefix + invoice.PublicId.ToString("D"));
        return emails.Count;
    }

    /// <summary>
    /// The airline's name and who receives its billing emails: its active portal accounts on AVIAM's business day
    /// (4-N10) and its billing email, once each.
    /// </summary>
    private static async Task<(string Airline, IReadOnlyList<string> Emails)> RecipientsAsync(ElevantDbContext context,
        long airlineId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == airlineId)
            .Select(item => new { item.Name, item.OrganizationId }).SingleAsync(cancellationToken);
        var today = BusinessCalendar.Today(now);
        var portalAccounts = context.OrganizationMemberships.AsNoTracking()
            .Where(item => item.OrganizationId == airline.OrganizationId && item.Kind == MembershipKind.AirlineClient &&
                item.Status == MembershipStatus.Active && (item.ValidFrom == null || item.ValidFrom <= today))
            .Select(item => item.AccountId);
        var emails = await context.Users.AsNoTracking()
            .Where(user => portalAccounts.Contains(user.Id) && user.Status == AccountLifecycleStatus.Active && user.Email != null)
            .Select(user => user.Email!).ToListAsync(cancellationToken);
        var billing = await context.AirlineBillingProfiles.AsNoTracking().Where(item => item.AirlineId == airlineId)
            .Select(item => item.BillingEmail).SingleOrDefaultAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(billing)) emails.Add(billing.Trim());
        return (airline.Name, emails.Distinct(StringComparer.OrdinalIgnoreCase).ToArray());
    }
}

/// <summary>Resolves <c>invoice:{publicId}</c> to the invoice PDF when the email is sent.</summary>
internal sealed class EfInvoiceAttachmentResolver(EfNonFiscalInvoiceReadStore invoices, IFinancialDocumentPdfRenderer renderer)
    : IEmailAttachmentResolver
{
    public async Task<EmailAttachment?> ResolveAsync(string reference, CancellationToken cancellationToken = default)
    {
        if (!reference.StartsWith(InvoiceEmails.AttachmentPrefix, StringComparison.Ordinal) ||
            !Guid.TryParse(reference[InvoiceEmails.AttachmentPrefix.Length..], out var invoiceId)) return null;
        var invoice = await invoices.SystemReadAsync(invoiceId, cancellationToken);
        return invoice is null ? null
            : new EmailAttachment($"factura-{invoice.Fiscal?.FiscalNumber ?? invoice.Number}.pdf", "application/pdf",
                renderer.RenderInvoice(invoice));
    }
}

/// <summary>Asks each resolver in turn; the first that recognizes the reference answers.</summary>
internal sealed class CompositeEmailAttachmentResolver(IReadOnlyList<IEmailAttachmentResolver> resolvers)
    : IEmailAttachmentResolver
{
    public async Task<EmailAttachment?> ResolveAsync(string reference, CancellationToken cancellationToken = default)
    {
        foreach (var resolver in resolvers)
            if (await resolver.ResolveAsync(reference, cancellationToken) is { } attachment) return attachment;
        return null;
    }
}
