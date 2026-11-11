namespace Elevant.Application.Finance;

public sealed record FinancePayablesDimensions(Guid? StationId = null, Guid? AirlineId = null, Guid? TurnaroundId = null, Guid? ServiceId = null);

public sealed record FinancePayablesFx(string Currency, decimal? RateToDop, string Source, DateOnly? RateDate);

public sealed record SupplierSave(Guid RequestId, Guid ScopeStationId, string Code, string Name, string? TaxReference, string? ContactEmail, bool IsActive, string? ExpectedVersion = null);

public sealed record SupplierView(Guid Id, Guid ScopeStationId, string Code, string Name, string? TaxReference, string? ContactEmail, bool IsActive, string Version);

public sealed record FinancePayablesLineInput(string Description, decimal Quantity, decimal UnitPrice, decimal TaxAmount);

public sealed record FinancePayablesSave(Guid RequestId, Guid SupplierId, Guid ScopeStationId, string DocumentReference, DateOnly DocumentDate, DateOnly DueDate, FinancePayablesFx Fx, FinancePayablesDimensions Dimensions, IReadOnlyList<FinancePayablesLineInput> Lines, string? ExpectedVersion = null);

public sealed record FinancePayablesDecision(Guid RequestId, string ExpectedVersion, string Decision, string? Reason = null);

public sealed record FinancePayablesLineView(Guid Id, int Number, string Description, decimal Quantity, decimal UnitPrice, decimal TaxAmount, decimal Total);

public sealed record FinancePayablesAttachmentView(Guid Id, string ContentType, long Length, string Sha256, DateTimeOffset UploadedAt);

public sealed record FinancePayablesReviewView(string Stage, string Decision, Guid ActorId, DateTimeOffset At, string? Reason);

/// <summary>
/// A supplier invoice as its reader sees it. 4-N14: <see cref="ApprovalBlocked"/> is true when the reader's person created
/// or submitted it, so the store refuses that reader's approval and another person of Finance approves it.
/// </summary>
public sealed record FinancePayablesView(Guid Id, Guid SupplierId, string SupplierName, Guid ScopeStationId, string DocumentReference, DateOnly DocumentDate, DateOnly DueDate, string Status, FinancePayablesFx Fx, FinancePayablesDimensions Dimensions, decimal Total, decimal TotalDop, decimal Paid, decimal Remaining, string Version, IReadOnlyList<FinancePayablesLineView> Lines, IReadOnlyList<FinancePayablesAttachmentView> Attachments, IReadOnlyList<FinancePayablesReviewView> Reviews, bool ApprovalBlocked = false);

public sealed record FinancePayablesPaymentSave(Guid RequestId, Guid SupplierId, Guid ScopeStationId, DateOnly PaidOn, string Reference, FinancePayablesFx Fx, decimal Amount);

public sealed record FinancePayablesApplicationInput(Guid InvoiceId, string ExpectedVersion, decimal PaymentAmount, decimal? RateToInvoice);

public sealed record FinancePayablesApply(Guid RequestId, string ExpectedVersion, IReadOnlyList<FinancePayablesApplicationInput> Applications);

public sealed record FinancePayablesApplicationView(Guid Id, Guid InvoiceId, decimal PaymentAmount, decimal InvoiceAmount, decimal RateToInvoice, DateTimeOffset AppliedAt, DateTimeOffset? ReversedAt = null, string? ReversalReason = null);

public sealed record FinancePayablesPaymentView(Guid Id, Guid SupplierId, Guid ScopeStationId, DateOnly PaidOn, string Reference, FinancePayablesFx Fx, decimal Amount, decimal Applied, decimal Remaining, string Version, IReadOnlyList<FinancePayablesApplicationView> Applications, DateTimeOffset? VoidedAt = null, string? VoidReason = null);

/// <summary>4-N04: reverses one application of a supplier payment or, without <see cref="ApplicationId"/>, voids the payment.</summary>
public sealed record FinancePayablesReverse(Guid RequestId, string ExpectedVersion, string? Reason, Guid? ApplicationId = null);

public sealed record EmployeeExpenseSave(Guid RequestId, Guid ScopeStationId, string Description, DateOnly ExpenseDate, FinancePayablesFx Fx, FinancePayablesDimensions Dimensions, IReadOnlyList<FinancePayablesLineInput> Lines, string? ExpectedVersion = null);

public sealed record EmployeeExpensePaymentSave(Guid RequestId, string ExpectedVersion, DateOnly PaidOn, string Reference, FinancePayablesFx Fx, decimal Amount, decimal? RateToExpense);

public sealed record EmployeeExpensePaymentView(Guid Id, DateOnly PaidOn, string Reference, FinancePayablesFx Fx, decimal Amount, decimal ExpenseAmount, decimal RateToExpense);

/// <summary>An employee expense; 4-N13: while submitted, <see cref="ReviewRoute"/> says who reviews it (Department, Finance or None).</summary>
public sealed record EmployeeExpenseView(Guid Id, Guid EmployeeId, string EmployeeNumber, Guid RequesterId, string Department, Guid ScopeStationId, string Description, DateOnly ExpenseDate, string Status, FinancePayablesFx Fx, FinancePayablesDimensions Dimensions, decimal Total, decimal TotalDop, decimal Paid, decimal Remaining, string Version, IReadOnlyList<FinancePayablesLineView> Lines, IReadOnlyList<FinancePayablesAttachmentView> Receipts, IReadOnlyList<FinancePayablesReviewView> Reviews, IReadOnlyList<EmployeeExpensePaymentView> Reimbursements, string? ReviewRoute = null);

/// <summary>4-N13: removes a receipt from a draft expense or supplier invoice; <see cref="ExpectedVersion"/> is the document's.</summary>
public sealed record FinancePayablesAttachmentRemoval(Guid RequestId, string ExpectedVersion);

public sealed record FinancePayablesOption(Guid Id, string Code, string Name);

public sealed record FinancePayablesOptions(IReadOnlyList<FinancePayablesOption> Stations, IReadOnlyList<FinancePayablesOption> Suppliers, IReadOnlyList<FinancePayablesOption> Airlines, IReadOnlyList<FinancePayablesOption> Services, IReadOnlyList<FinancePayablesOption> Turnarounds, IReadOnlyList<string> Currencies, Guid? EmployeeId, string? Department, bool CanCreateOwnExpense = false, bool CanReadOwnExpenses = false, bool CanReviewDepartmentExpenses = false, bool CanReadFinanceExpenses = false, bool CanApproveFinanceExpenses = false, bool CanPayFinanceExpenses = false);

public sealed record FinancePayablesFilter(Guid? ScopeStationId = null, Guid? SupplierId = null, string? Status = null, DateOnly? From = null, DateOnly? To = null, string? Search = null, int Skip = 0, int Take = 50, Guid? EmployeeId = null, bool OutstandingOnly = false, bool OwnOnly = false, bool DepartmentOnly = false);

public sealed record FinancePayablesMutation(Guid Id, bool Replayed);

public sealed record FinancePayablesResult<T>(T? Value, string? Failure = null)
{
    public bool IsSuccess => Failure is null;
    public static FinancePayablesResult<T> Fail(string failure) => new(default, failure);
}
public sealed record FinancePayablesAttachmentContent(byte[] Bytes, string ContentType, string Sha256);
