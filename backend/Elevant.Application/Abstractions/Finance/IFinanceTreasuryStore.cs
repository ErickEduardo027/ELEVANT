namespace Elevant.Application.Abstractions.Finance;
/// <summary>Persistent receivables treasury. Every method resolves current membership, permissions and resource scopes.</summary>
public interface IFinanceTreasuryStore
{
    Task<AirlineTreasuryReadResult<AirlineTreasuryStatementData>> PortalStatementAsync(Guid actorId, DateOnly asOf, Guid? stationId, CancellationToken cancellationToken = default);
    Task<AirlineTreasuryReadResult<AirlineTreasuryInvoiceDetailData>> PortalInvoiceAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default);
    Task<AirlineTreasuryReadResult<AirlineTreasuryReceiptData>> PortalReceiptAsync(Guid actorId, Guid receiptId, CancellationToken cancellationToken = default);
    Task<AirlineTreasuryReadResult<AirlineTreasuryAdjustmentsData>> PortalAdjustmentsAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryOptionsData?> OptionsAsync(Guid actorId, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryReceiptPageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId, int page, int limit, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryReceiptData?> GetAsync(Guid actorId, Guid receiptId, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryResult> RecordAsync(Guid actorId, FinanceTreasuryReceiptInput input, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryResult> ApplyAsync(Guid actorId, Guid receiptId, FinanceTreasuryApplyInput input, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryResult> ReverseAsync(Guid actorId, Guid receiptId, FinanceTreasuryReverseInput input, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryResult> RefundAsync(Guid actorId, Guid receiptId, FinanceTreasuryRefundInput input, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryAdjustmentsData?> AdjustmentsAsync(Guid actorId, Guid invoiceId, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryResult> IssueAdjustmentAsync(Guid actorId, Guid invoiceId, FinanceTreasuryAdjustmentInput input, CancellationToken cancellationToken = default);
    Task<FinanceTreasuryStatementData?> StatementAsync(Guid actorId, DateOnly asOf, Guid? stationId, Guid? airlineId, CancellationToken cancellationToken = default);
}
