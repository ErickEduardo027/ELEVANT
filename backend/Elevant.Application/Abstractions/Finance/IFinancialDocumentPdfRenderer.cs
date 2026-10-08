using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IFinancialDocumentPdfRenderer
{
    byte[] RenderInvoice(NonFiscalInvoiceData invoice);
    byte[] RenderReceipt(NonFiscalPaymentData payment, string invoiceNumber);

    /// <summary>Tabular, landscape finance report with its filters and the non-fiscal notice.</summary>
    byte[] RenderReport(FinanceReportData report, string filterSummary);
}
