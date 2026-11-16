namespace Elevant.Application.Finance;

// 4-A (ADR-0035, block 3): the preinvoice left the product. These are the models of the internal draft that values the
// approved services and of the invoice issued from it, both inside the one issuance transaction of «Por facturar»; no
// endpoint, permission or screen exposes them.

/// <summary>The approved services of one station and period the issuance values in its internal draft.</summary>
public sealed record CreatePreinvoiceDraftCommand(
    Guid AccountId, Guid StationId, DateOnly From, DateOnly To,
    Guid RequestId, IReadOnlyList<Guid> ServiceIds);

public enum PreinvoiceDraftFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
    Unprocessable,
}

public sealed record PreinvoiceDraftResult(
    Guid? DraftId, bool Replayed, PreinvoiceDraftFailure? Failure, string? Reason)
{
    public bool IsSuccess => DraftId.HasValue && Failure is null;
    public static PreinvoiceDraftResult Success(Guid draftId, bool replayed) =>
        new(draftId, replayed, null, null);
    public static PreinvoiceDraftResult Failed(PreinvoiceDraftFailure failure, string? reason = null) =>
        new(null, false, failure, reason);
}

/// <summary>The invoice of an internal draft, issued inside the caller's transaction.</summary>
public sealed record IssueFinanceInvoiceCommand(Guid AccountId, Guid PreinvoiceId, Guid RequestId);

public enum IssueFinanceInvoiceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record IssueFinanceInvoiceResult(
    Guid? InvoiceId, string? Number, bool Replayed, IssueFinanceInvoiceFailure? Failure)
{
    public bool IsSuccess => InvoiceId.HasValue && Number is not null && Failure is null;
    public static IssueFinanceInvoiceResult Success(Guid id, string number, bool replayed) =>
        new(id, number, replayed, null);
    public static IssueFinanceInvoiceResult Failed(IssueFinanceInvoiceFailure failure) =>
        new(null, null, false, failure);
}
