namespace Elevant.Application.Finance;

/// <summary>
/// One «Factura emitida» email of an invoice (1-N08): its recipient, delivery status and, when it
/// was not sent, the normalized reason. The body is never read.
/// </summary>
public sealed record InvoiceEmailDeliveryData(string Recipient, string Status, string? Reason,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt);

/// <summary>
/// The emails an issued invoice queued, so the issuing screen states what really happened instead
/// of claiming the email was sent (ADR-0022). An empty list means nobody could receive it.
/// </summary>
public interface IInvoiceEmailStatusStore
{
    /// <summary>
    /// The invoice's emails for a Finance actor with invoicing or reconciliation access to its
    /// station; null when the invoice does not exist or is out of the actor's reach.
    /// </summary>
    Task<IReadOnlyList<InvoiceEmailDeliveryData>?> ListAsync(Guid actorId, Guid invoiceId,
        CancellationToken cancellationToken = default);
}
