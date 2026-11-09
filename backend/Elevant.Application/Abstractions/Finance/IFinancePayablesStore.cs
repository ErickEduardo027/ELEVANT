using Elevant.Application.Finance;
namespace Elevant.Application.Abstractions.Finance;

public interface IFinancePayablesStore
{
    Task<FinancePayablesResult<IReadOnlyList<SupplierView>>> ListSuppliersAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default);
    Task<FinancePayablesResult<SupplierView>> GetSupplierAsync(Guid actorId, Guid id, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> SaveSupplierAsync(Guid actorId, Guid? id, SupplierSave input, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> DeleteSupplierAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default);
    Task<FinancePayablesResult<IReadOnlyList<FinancePayablesView>>> ListInvoicesAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesView>> GetInvoiceAsync(Guid actorId, Guid id, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> SaveInvoiceAsync(Guid actorId, Guid? id, FinancePayablesSave input, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> DecideInvoiceAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default);
    Task<FinancePayablesResult<IReadOnlyList<FinancePayablesPaymentView>>> ListPaymentsAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesPaymentView>> GetPaymentAsync(Guid actorId, Guid id, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> RecordPaymentAsync(Guid actorId, FinancePayablesPaymentSave input, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> ApplyPaymentAsync(Guid actorId, Guid id, FinancePayablesApply input, CancellationToken ct = default);
    /// <summary>4-N04: reverses one application of the payment or voids it once nothing of it is applied (linked rows).</summary>
    Task<FinancePayablesResult<FinancePayablesMutation>> ReversePaymentAsync(Guid actorId, Guid id, FinancePayablesReverse input, CancellationToken ct = default);
    Task<FinancePayablesResult<IReadOnlyList<EmployeeExpenseView>>> ListExpensesAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default);
    Task<FinancePayablesResult<EmployeeExpenseView>> GetExpenseAsync(Guid actorId, Guid id, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> SaveExpenseAsync(Guid actorId, Guid? id, EmployeeExpenseSave input, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> DecideExpenseAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> ReimburseExpenseAsync(Guid actorId, Guid id, EmployeeExpensePaymentSave input, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesOptions>> OptionsAsync(Guid actorId, Guid? scopeStationId, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesMutation>> UploadAttachmentAsync(Guid actorId, Guid id, bool expense, Guid requestId, string expectedVersion, string contentType, byte[] bytes, CancellationToken ct = default);
    Task<FinancePayablesResult<FinancePayablesAttachmentContent>> DownloadAttachmentAsync(Guid actorId, Guid id, bool expense, Guid attachmentId, CancellationToken ct = default);
    /// <summary>
    /// 4-N13: removes a receipt from a draft expense (its requester) or supplier invoice (<c>finance.payables.update</c>).
    /// The row stays, marked removed; its bytes are erased once committed only when no submission ever included it.
    /// </summary>
    Task<FinancePayablesResult<FinancePayablesMutation>> RemoveAttachmentAsync(Guid actorId, Guid id, bool expense, Guid attachmentId, FinancePayablesAttachmentRemoval input, CancellationToken ct = default);
}
