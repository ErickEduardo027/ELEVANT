namespace Elevant.Application.Finance;

/// <summary>
/// Problem Details codes of invoicing (phase 4, block A): the issuance from operations, «Por facturar» and the
/// no-charge closure. A valuation that blocks keeps its own reason (<c>exchange_rate_missing</c>,
/// <c>contract_charge_rate_missing</c>, <c>package_*</c>…) as the code; the screens explain each one in Spanish.
/// </summary>
public static class InvoicingCodes
{
    public const string InvalidRequest = "invalid_invoice_request";
    public const string InvalidPendingQuery = "invalid_pending_query";
    public const string Forbidden = "forbidden";
    public const string NotFound = "not_found";
    public const string IdempotencyConflict = "idempotency_conflict";
    public const string IdempotencyKeyRequired = "idempotency_key_required";
    public const string VersionConflict = "version_conflict";
    public const string ExpectedVersionRequired = "expected_version_required";
    public const string ReasonRequired = "reason_required";

    /// <summary>The selection changed while it was issued (the draft could not be issued as it stood).</summary>
    public const string StateChanged = "invoice_state_changed";

    public const string OperationNotApproved = "operation_not_approved";
    public const string AlreadyInvoiced = "already_invoiced";

    /// <summary>An older internal draft without an invoice still holds a service of the operation.</summary>
    public const string PendingPreinvoice = "pending_preinvoice";

    public const string MixedAirline = "mixed_airline";
    public const string NothingToInvoice = "nothing_to_invoice";
    public const string StationInactive = "station_inactive";
    public const string AirlineInactive = "airline_inactive";

    /// <summary>4-N07: an invoice is never issued for zero; the operations can be closed without charge.</summary>
    public const string ZeroTotal = "zero_total";

    /// <summary>4-N07: the operations to close without charge have an amount: they are invoiced.</summary>
    public const string OperationHasCharge = "operation_has_charge";

    /// <summary>4-N06: more than <see cref="FinanceInvoicePolicy.MaxLines"/> invoice lines.</summary>
    public const string TooManyLines = "too_many_lines";

    /// <summary>4-N06: more than <see cref="FinanceInvoicePolicy.MaxOperations"/> operations.</summary>
    public const string TooManyOperations = "too_many_operations";

    /// <summary>4-N06: operations of more than <see cref="FinanceInvoicePolicy.MaxDays"/> days.</summary>
    public const string DateWindowExceeded = "date_window_exceeded";
}
