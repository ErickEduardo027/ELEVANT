using Elevant.Application.Abstractions.Messaging;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// The «Factura emitida» emails of one invoice (1-N08), found by the attachment reference the
/// issuance queued. Finance reads them with the invoicing or reconciliation access to the
/// invoice's station; bodies are never read.
/// </summary>
internal sealed class EfInvoiceEmailStatusStore(ElevantDbContext context, TimeProvider timeProvider)
    : IInvoiceEmailStatusStore
{
    public async Task<IReadOnlyList<InvoiceEmailDeliveryData>?> ListAsync(Guid actorId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        if (actorId == Guid.Empty || invoiceId == Guid.Empty) return null;
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(actorId, cancellationToken);
        if (actor is null || !FinanceInvoicePolicy.CanReadInvoiceEmails(actor) ||
            !actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        var stations = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var visible = await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                             join station in context.Stations.AsNoTracking() on invoice.StationId equals station.Id
                             where invoice.PublicId == invoiceId && stations.Contains(station.PublicId)
                             select invoice.Id).AnyAsync(cancellationToken);
        if (!visible) return null;
        var reference = InvoiceEmails.AttachmentPrefix + invoiceId.ToString("D");
        var rows = await context.Set<EmailOutboxMessage>().AsNoTracking()
            .Where(item => item.Purpose == EmailPurpose.InvoiceIssued && item.AttachmentReference == reference)
            .OrderBy(item => item.Id)
            .Select(item => new { item.Recipient, item.Status, item.LastError, item.CreatedAt, item.SentAt })
            .ToArrayAsync(cancellationToken);
        return rows.Select(row => new InvoiceEmailDeliveryData(row.Recipient, row.Status.ToString(),
            row.Status == EmailDeliveryStatus.Sent ? null : EmailDeliveryReasons.Normalize(row.LastError),
            row.CreatedAt, row.SentAt)).ToArray();
    }
}
