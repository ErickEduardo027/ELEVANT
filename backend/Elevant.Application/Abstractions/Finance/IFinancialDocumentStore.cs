using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

/// <summary>Private financial PDF storage; never reuses public commercial-media access.</summary>
public interface IFinancialDocumentStore
{
    Task<FinancialDocumentData> OpenInvoiceAsync(NonFiscalInvoiceData invoice,
        CancellationToken cancellationToken = default);

    Task<FinancialDocumentData> OpenReceiptAsync(NonFiscalPaymentData payment,
        string invoiceNumber, CancellationToken cancellationToken = default);
}
