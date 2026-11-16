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

    /// <summary>4-N17: a credit or debit note with its e-NCF E34/E33 and frozen ITBIS, «Simulación — sin validez fiscal».</summary>
    byte[] RenderAdjustmentNote(FinanceAdjustmentNoteDocumentData note) => throw new NotSupportedException();
}
