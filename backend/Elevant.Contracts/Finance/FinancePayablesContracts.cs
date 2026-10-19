namespace Elevant.Contracts.Finance;

public sealed record FinancePayablesDimensionsDto(Guid? StationId = null, Guid? AirlineId = null, Guid? TurnaroundId = null, Guid? ServiceId = null);

public sealed record FinancePayablesFxDto(string Currency, decimal? RateToDop, string Source, DateOnly? RateDate);

public sealed record SupplierSaveDto(Guid RequestId, Guid ScopeStationId, string Code, string Name, string? TaxReference, string? ContactEmail, bool IsActive, string? ExpectedVersion = null);

public sealed record SupplierViewDto(Guid Id, Guid ScopeStationId, string Code, string Name, string? TaxReference, string? ContactEmail, bool IsActive, string Version);

public sealed record FinancePayablesLineInputDto(string Description, decimal Quantity, decimal UnitPrice, decimal TaxAmount);

public sealed record FinancePayablesSaveDto(Guid RequestId, Guid SupplierId, Guid ScopeStationId, string DocumentReference, DateOnly DocumentDate, DateOnly DueDate, FinancePayablesFxDto Fx, FinancePayablesDimensionsDto Dimensions, IReadOnlyList<FinancePayablesLineInputDto> Lines, string? ExpectedVersion = null);

public sealed record FinancePayablesDecisionDto(Guid RequestId, string ExpectedVersion, string Decision, string? Reason = null);

public sealed record FinancePayablesLineViewDto(Guid Id, int Number, string Description, decimal Quantity, decimal UnitPrice, decimal TaxAmount, decimal Total);

public sealed record FinancePayablesAttachmentViewDto(Guid Id, string ContentType, long Length, string Sha256, DateTimeOffset UploadedAt);

public sealed record FinancePayablesReviewViewDto(string Stage, string Decision, Guid ActorId, DateTimeOffset At, string? Reason);

public sealed record FinancePayablesViewDto(Guid Id, Guid SupplierId, string SupplierName, Guid ScopeStationId, string DocumentReference, DateOnly DocumentDate, DateOnly DueDate, string Status, FinancePayablesFxDto Fx, FinancePayablesDimensionsDto Dimensions, decimal Total, decimal TotalDop, decimal Paid, decimal Remaining, string Version, IReadOnlyList<FinancePayablesLineViewDto> Lines, IReadOnlyList<FinancePayablesAttachmentViewDto> Attachments, IReadOnlyList<FinancePayablesReviewViewDto> Reviews);

public sealed record FinancePayablesPaymentSaveDto(Guid RequestId, Guid SupplierId, Guid ScopeStationId, DateOnly PaidOn, string Reference, FinancePayablesFxDto Fx, decimal Amount);

public sealed record FinancePayablesApplicationInputDto(Guid InvoiceId, string ExpectedVersion, decimal PaymentAmount, decimal? RateToInvoice);

public sealed record FinancePayablesApplyDto(Guid RequestId, string ExpectedVersion, IReadOnlyList<FinancePayablesApplicationInputDto> Applications);

public sealed record FinancePayablesApplicationViewDto(Guid Id, Guid InvoiceId, decimal PaymentAmount, decimal InvoiceAmount, decimal RateToInvoice, DateTimeOffset AppliedAt);

public sealed record FinancePayablesPaymentViewDto(Guid Id, Guid SupplierId, Guid ScopeStationId, DateOnly PaidOn, string Reference, FinancePayablesFxDto Fx, decimal Amount, decimal Applied, decimal Remaining, string Version, IReadOnlyList<FinancePayablesApplicationViewDto> Applications);

public sealed record EmployeeExpenseSaveDto(Guid RequestId, Guid ScopeStationId, string Description, DateOnly ExpenseDate, FinancePayablesFxDto Fx, FinancePayablesDimensionsDto Dimensions, IReadOnlyList<FinancePayablesLineInputDto> Lines, string? ExpectedVersion = null);

public sealed record EmployeeExpensePaymentSaveDto(Guid RequestId, string ExpectedVersion, DateOnly PaidOn, string Reference, FinancePayablesFxDto Fx, decimal Amount, decimal? RateToExpense);

public sealed record EmployeeExpensePaymentViewDto(Guid Id, DateOnly PaidOn, string Reference, FinancePayablesFxDto Fx, decimal Amount, decimal ExpenseAmount, decimal RateToExpense);

public sealed record EmployeeExpenseViewDto(Guid Id, Guid EmployeeId, string EmployeeNumber, Guid RequesterId, string Department, Guid ScopeStationId, string Description, DateOnly ExpenseDate, string Status, FinancePayablesFxDto Fx, FinancePayablesDimensionsDto Dimensions, decimal Total, decimal TotalDop, decimal Paid, decimal Remaining, string Version, IReadOnlyList<FinancePayablesLineViewDto> Lines, IReadOnlyList<FinancePayablesAttachmentViewDto> Receipts, IReadOnlyList<FinancePayablesReviewViewDto> Reviews, IReadOnlyList<EmployeeExpensePaymentViewDto> Reimbursements);

public sealed record FinancePayablesOptionDto(Guid Id, string Code, string Name);

public sealed record FinancePayablesOptionsDto(IReadOnlyList<FinancePayablesOptionDto> Stations, IReadOnlyList<FinancePayablesOptionDto> Suppliers, IReadOnlyList<FinancePayablesOptionDto> Airlines, IReadOnlyList<FinancePayablesOptionDto> Services, IReadOnlyList<FinancePayablesOptionDto> Turnarounds, IReadOnlyList<string> Currencies, Guid? EmployeeId, string? Department, bool CanCreateOwnExpense = false, bool CanReadOwnExpenses = false, bool CanReviewDepartmentExpenses = false, bool CanReadFinanceExpenses = false, bool CanApproveFinanceExpenses = false, bool CanPayFinanceExpenses = false);

public sealed record FinancePayablesFilterDto(Guid? ScopeStationId = null, Guid? SupplierId = null, string? Status = null, DateOnly? From = null, DateOnly? To = null, string? Search = null, int Skip = 0, int Take = 50, Guid? EmployeeId = null, bool OutstandingOnly = false, bool OwnOnly = false, bool DepartmentOnly = false);

public sealed record FinancePayablesMutationDto(Guid Id, bool Replayed);