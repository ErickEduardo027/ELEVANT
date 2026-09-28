using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IFinancialDocumentPdfRenderer
{
    byte[] RenderInvoice(NonFiscalInvoiceData invoice);
    byte[] RenderReceipt(NonFiscalPaymentData payment, string invoiceNumber);
}
