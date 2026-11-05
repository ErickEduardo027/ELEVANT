using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Elevant.Contracts.Finance;

/// <summary>
/// Finance issues one simulated e-CF invoice for one completed operation or for several of the same
/// airline and currency (ADR-0035). The same request id again returns the invoice already issued.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record IssueInvoiceFromOperationsRequest
{
    public Guid StationId { get; init; }

    [MinLength(1), MaxLength(100)]
    public IReadOnlyList<Guid> OperationIds { get; init; } = [];

    public Guid RequestId { get; init; }
}

public sealed record IssuedInvoiceResponse(Guid InvoiceId, string Number, string FiscalNumber, decimal Total,
    string CurrencyCode, bool Replayed);
