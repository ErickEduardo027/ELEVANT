using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Commercial;

namespace Elevant.Application.Finance;

public sealed record FinancialDocumentData(Guid Id, string Kind, string FileName,
    byte[] Content, string Sha256);

public sealed record AirlineFinancialDocumentResult(
    FinancialDocumentData? Document, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Document is not null && Failure is null;
    public static AirlineFinancialDocumentResult Success(FinancialDocumentData document) =>
        new(document, null);
    public static AirlineFinancialDocumentResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}

/// <summary>Rechecks live tenant/station access after reading private object bytes.</summary>
public sealed class GetFinancialDocumentHandler(
    GetNonFiscalInvoiceHandler invoices, GetNonFiscalPaymentHandler payments,
    IFinancialDocumentStore documents, INonFiscalInvoiceReadStore? invoiceLookup = null)
{
    // 4-A: the internal draft addresses an invoice only inside this handler; callers use the invoice id.
    private async Task<AirlineFinancialDocumentResult> GetAirlineInvoiceAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken)
    {
        var first = await invoices.GetForAirlineAsync(accountId, preinvoiceId, cancellationToken);
        if (!first.IsSuccess) return AirlineFinancialDocumentResult.Failed(first.Failure!.Value);
        var document = await documents.OpenInvoiceAsync(first.Invoice!, cancellationToken);
        var latest = await invoices.GetForAirlineAsync(accountId, preinvoiceId, cancellationToken);
        if (!latest.IsSuccess) return AirlineFinancialDocumentResult.Failed(latest.Failure!.Value);
        return latest.Invoice!.Id == first.Invoice!.Id
            ? AirlineFinancialDocumentResult.Success(document)
            : AirlineFinancialDocumentResult.Failed(AirlinePortalFailure.NotFound);
    }

    public async Task<AirlineFinancialDocumentResult> GetAirlineReceiptAsync(
        Guid accountId, Guid invoiceId, CancellationToken cancellationToken = default)
    {
        var first = await payments.GetForAirlineAsync(accountId, invoiceId, cancellationToken);
        if (!first.IsSuccess) return AirlineFinancialDocumentResult.Failed(first.Failure!.Value);
        if (first.Lookup!.Payment is null)
            return AirlineFinancialDocumentResult.Failed(AirlinePortalFailure.NotFound);
        var document = await documents.OpenReceiptAsync(first.Lookup.Payment,
            first.Lookup.InvoiceNumber, cancellationToken);
        var latest = await payments.GetForAirlineAsync(accountId, invoiceId, cancellationToken);
        if (!latest.IsSuccess) return AirlineFinancialDocumentResult.Failed(latest.Failure!.Value);
        return latest.Lookup!.Payment?.Id == first.Lookup.Payment.Id
            ? AirlineFinancialDocumentResult.Success(document)
            : AirlineFinancialDocumentResult.Failed(AirlinePortalFailure.NotFound);
    }

    private async Task<FinancialDocumentData?> GetFinanceInvoiceAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken)
    {
        var first = await invoices.GetForFinanceAsync(accountId, preinvoiceId, cancellationToken);
        if (first is null) return null;
        var document = await documents.OpenInvoiceAsync(first, cancellationToken);
        var latest = await invoices.GetForFinanceAsync(accountId, preinvoiceId, cancellationToken);
        return latest?.Id == first.Id ? document : null;
    }

    /// <summary>ADR-0035: the invoice PDF addressed by the invoice id.</summary>
    public async Task<AirlineFinancialDocumentResult> GetAirlineInvoiceByIdAsync(Guid accountId, Guid invoiceId,
        CancellationToken cancellationToken = default) =>
        invoiceLookup is not null && await invoiceLookup.PreinvoiceOfInvoiceAsync(invoiceId, cancellationToken) is { } preinvoiceId
            ? await GetAirlineInvoiceAsync(accountId, preinvoiceId, cancellationToken)
            : AirlineFinancialDocumentResult.Failed(AirlinePortalFailure.NotFound);

    public async Task<FinancialDocumentData?> GetFinanceInvoiceByIdAsync(Guid accountId, Guid invoiceId,
        CancellationToken cancellationToken = default) =>
        invoiceLookup is not null && await invoiceLookup.PreinvoiceOfInvoiceAsync(invoiceId, cancellationToken) is { } preinvoiceId
            ? await GetFinanceInvoiceAsync(accountId, preinvoiceId, cancellationToken)
            : null;

    public async Task<FinancialDocumentData?> GetFinanceReceiptAsync(
        Guid accountId, Guid invoiceId, CancellationToken cancellationToken = default)
    {
        var first = await payments.GetForFinanceAsync(accountId, invoiceId, cancellationToken);
        if (first?.Payment is null) return null;
        var document = await documents.OpenReceiptAsync(first.Payment,
            first.InvoiceNumber, cancellationToken);
        var latest = await payments.GetForFinanceAsync(accountId, invoiceId, cancellationToken);
        return latest?.Payment?.Id == first.Payment.Id ? document : null;
    }
}
