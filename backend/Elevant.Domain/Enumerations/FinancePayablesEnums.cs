namespace Elevant.Domain.Enumerations;
/// <summary>
/// Status of a supplier invoice. 4-N03: <see cref="Voided"/> withdraws a draft, a rejected invoice or an approved one
/// without active applications, with its reason; it frees the document reference and is never deleted.
/// </summary>
public enum SupplierInvoiceStatus { Draft, Submitted, Approved, Rejected, Voided }
/// <summary>
/// Status of an employee expense. 4-N13: <see cref="Cancelled"/> is a draft or a rejected claim the requester discarded,
/// with its reason; it is never deleted.
/// </summary>
public enum EmployeeExpenseStatus { Draft, Submitted, DepartmentApproved, Approved, Rejected, Cancelled }
