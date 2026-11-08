using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Finance;

/// <summary>
/// Finance issues one simulated e-CF invoice for one completed operation or for several of the same
/// airline and currency (ADR-0035). The same request id again returns the invoice already issued; with another
/// account, station or operations it is 409 <c>idempotency_conflict</c> (4-N29).
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record IssueInvoiceFromOperationsRequest
{
    public Guid StationId { get; init; }

    [MinLength(1), MaxLength(100)]
    public IReadOnlyList<Guid> OperationIds { get; init; } = [];

    public Guid RequestId { get; init; }

    /// <summary>
    /// 4-N29: the version of each operation as Finance saw it (a stale one is 409 <c>version_conflict</c>). Optional
    /// while older clients exist; when sent it covers every operation exactly once.
    /// </summary>
    [MaxLength(100)]
    public IReadOnlyList<FinanceOperationVersionRequest>? OperationVersions { get; init; }
}

public sealed record IssuedInvoiceResponse(Guid InvoiceId, string Number, string FiscalNumber, decimal Total,
    string CurrencyCode, bool Replayed);

/// <summary>
/// One «Factura emitida» email of an invoice (1-N08). <c>Status</c> is Pending, Sent, Failed or
/// Discarded; <c>Reason</c> is the normalized code of an email that was not sent.
/// </summary>
public sealed record InvoiceEmailDeliveryResponse(string Recipient, string Status, string? Reason,
    DateTimeOffset CreatedAt, DateTimeOffset? SentAt);

/// <summary>
/// The emails an issued invoice queued and whether SMTP is configured, so the issuing screen states
/// what really happened (ADR-0022). No deliveries means nobody could receive it.
/// </summary>
public sealed record InvoiceEmailStatusResponse(Guid InvoiceId, bool SmtpConfigured,
    IReadOnlyList<InvoiceEmailDeliveryResponse> Deliveries);
