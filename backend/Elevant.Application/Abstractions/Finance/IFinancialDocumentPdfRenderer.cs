using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IFinancialDocumentPdfRenderer
{
    byte[] RenderInvoice(NonFiscalInvoiceData invoice);
    byte[] RenderReceipt(NonFiscalPaymentData payment, string invoiceNumber);

    /// <summary>Tabular, landscape finance report with its filters and the non-fiscal notice.</summary>
    byte[] RenderReport(FinanceReportData report, string filterSummary);

    /// <summary>ADR-0036: receipt of an approved simulated card payment.</summary>
    byte[] RenderCardReceipt(CardPaymentReceiptData receipt) => throw new NotSupportedException();
}
