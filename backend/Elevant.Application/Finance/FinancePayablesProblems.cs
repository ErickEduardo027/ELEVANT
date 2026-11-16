namespace Elevant.Application.Finance;

/// <summary>
/// 4-N27: the stable Problem Details codes of suppliers, supplier invoices, supplier payments and employee expenses,
/// and the HTTP status each one answers. The clients explain the code in Spanish; the title stays technical.
/// </summary>
public static class FinancePayablesProblems
{
    public const string Unauthorized = "unauthorized";
    public const string Forbidden = "forbidden";
    /// <summary>4-N14: who creates or submits a supplier invoice does not approve it; who approves it does not pay it.</summary>
    public const string SegregationOfDuties = "segregation_of_duties";
    public const string NotFound = "not_found";
    public const string VersionConflict = "version_conflict";
    public const string IdempotencyConflict = "idempotency_conflict";
    /// <summary>The document is in a status that does not admit the action (an edit outside Draft, a skipped stage…).</summary>
    public const string InvalidState = "invalid_state";
    /// <summary>4-N03: another invoice of the supplier that is not voided already carries the document reference.</summary>
    public const string DuplicateReference = "duplicate_reference";
    public const string DuplicateSupplierCode = "duplicate_supplier_code";
    /// <summary>4-N15: the supplier was retired; only voiding and applying already recorded payments remain.</summary>
    public const string SupplierInactive = "supplier_inactive";
    /// <summary>4-N15: a supplier with invoices in progress, a balance or unapplied payments is not retired.</summary>
    public const string SupplierHasOpenBalance = "supplier_has_open_balance";
    /// <summary>4-N03: an approved invoice with active applications is voided only after reversing them.</summary>
    public const string InvoiceHasApplications = "invoice_has_applications";
    /// <summary>4-N04: a payment with active applications is voided only after reversing them.</summary>
    public const string PaymentHasApplications = "payment_has_applications";
    public const string PaymentVoided = "payment_voided";
    public const string AlreadyReversed = "already_reversed";
    public const string BalanceExceeded = "balance_exceeded";
    public const string Invalid = "invalid";
    /// <summary>A reason of 5 to 500 characters (phase 4) is missing or out of bounds.</summary>
    public const string ReasonRequired = "reason_required";
    public const string ReceiptRequired = "receipt_required";
    /// <summary>The expense date is outside the employee's assignment to the station (it was answered as forbidden).</summary>
    public const string ExpenseDateOutsideAssignment = "expense_date_outside_assignment";
    public const string AttachmentLimit = "attachment_limit";
    public const string InvalidAttachment = "invalid_attachment";
    public const string Unavailable = "unavailable";

    /// <summary>The HTTP status of a code; an unknown code is a 400.</summary>
    public static int StatusOf(string? code) => code switch
    {
        Unauthorized => 401,
        Forbidden or SegregationOfDuties => 403,
        NotFound => 404,
        VersionConflict or IdempotencyConflict or InvalidState or DuplicateReference or DuplicateSupplierCode or
            SupplierInactive or SupplierHasOpenBalance or InvoiceHasApplications or PaymentHasApplications or
            PaymentVoided or AlreadyReversed or BalanceExceeded => 409,
        Unavailable => 503,
        _ => 400,
    };
}
