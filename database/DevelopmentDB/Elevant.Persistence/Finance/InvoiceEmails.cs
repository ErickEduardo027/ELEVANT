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
/// Queues the «Factura emitida» email (ADR-0035) for the airline's active portal accounts and its
/// billing email. The PDF is rendered when the email is sent, never stored in the outbox.
/// </summary>
internal static class InvoiceEmails
{
    public const string AttachmentPrefix = "invoice:";

    public static async Task QueueIssuedAsync(ElevantDbContext context, NonFiscalInvoice invoice, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == invoice.AirlineId)
            .Select(item => new { item.Name, item.OrganizationId }).SingleAsync(cancellationToken);
        var today = BusinessCalendar.Today(now);
        var portalAccounts = context.OrganizationMemberships.AsNoTracking()
            .Where(item => item.OrganizationId == airline.OrganizationId && item.Kind == MembershipKind.AirlineClient &&
                item.Status == MembershipStatus.Active && (item.ValidFrom == null || item.ValidFrom <= today))
            .Select(item => item.AccountId);
        var emails = await context.Users.AsNoTracking()
            .Where(user => portalAccounts.Contains(user.Id) && user.Status == AccountLifecycleStatus.Active && user.Email != null)
            .Select(user => user.Email!).ToListAsync(cancellationToken);
        var billing = await context.AirlineBillingProfiles.AsNoTracking().Where(item => item.AirlineId == invoice.AirlineId)
            .Select(item => item.BillingEmail).SingleOrDefaultAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(billing)) emails.Add(billing.Trim());
        var balance = await FinanceTreasuryBalances.BalanceAsync(context, invoice.Id, invoice.Total, cancellationToken);
        foreach (var email in emails.Distinct(StringComparer.OrdinalIgnoreCase))
            EfEmailOutboxStore.Add(context,
                AccountEmailTemplates.InvoiceIssued(email, airline.Name, invoice.FiscalNumber ?? invoice.Number,
                    invoice.CurrencyCode, invoice.Total, balance, invoice.DueDate),
                EmailPurpose.InvoiceIssued, now, AttachmentPrefix + invoice.PublicId.ToString("D"));
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
