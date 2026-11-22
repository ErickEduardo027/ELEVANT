using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.Persistence.Finance;

/// <summary>
/// The frozen commercial snapshot of an issued invoice (<see cref="NonFiscalInvoice.CommercialSnapshotJson"/>): issuer,
/// customer, airline and station identities, terms and the aggregate amounts. One serializer for the issuance store
/// and the Development history, so both write the same JSON.
/// </summary>
internal static class FinanceInvoiceSnapshot
{
    /// <summary>An organization as the snapshot names it (issuer or customer).</summary>
    internal sealed record Party(Guid PublicId, string Code, string LegalName, string DisplayName);

    internal sealed record AirlineIdentity(Guid PublicId, string Name, string? IataCode, string IcaoCode);

    internal sealed record StationIdentity(Guid PublicId, string Code, string Name);

    /// <summary>
    /// The snapshot of <paramref name="invoice"/> (its currency, terms and totals must already be set) captured at
    /// <paramref name="capturedAt"/>.
    /// </summary>
    public static string Serialize(NonFiscalInvoice invoice, DateTimeOffset capturedAt, Party? issuer, Party customer,
        AirlineIdentity airline, StationIdentity station, string? customerTaxRegistration,
        string? customerTaxRegistrationCountryCode)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        return JsonSerializer.Serialize(new
        {
            version = 1, capturedAt, issuer, customer, airline, station,
            invoice.CurrencyCode, invoice.PaymentTermDays, invoice.DueDate,
            net = invoice.NetTotal, discount = invoice.DiscountTotal, tax = invoice.TaxTotal, gross = invoice.Total,
            treatmentsConfigured = invoice.TaxTreatmentsConfigured,
            issuerTaxRegistration = FinanceInvoicePolicy.SimulatedIssuerRnc,
            customerTaxRegistration,
            customerTaxRegistrationCountryCode = customerTaxRegistrationCountryCode?.Trim(),
            fiscalDisclaimer = FinanceInvoicePolicy.Disclaimer,
        });
    }
}

/// <summary>The copy of a frozen preinvoice line onto the invoice that issues it.</summary>
internal static class NonFiscalInvoiceLines
{
    /// <summary>
    /// The invoice line of <paramref name="line"/>; <paramref name="parentLineNumber"/> is the line number of its parent
    /// (a charge, minimum or package line's service line), null for a service line.
    /// </summary>
    public static NonFiscalInvoiceLine From(PreinvoiceLine line, long invoiceId, int? parentLineNumber, Guid publicId,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(line);
        return new NonFiscalInvoiceLine
        {
            PublicId = publicId, InvoiceId = invoiceId,
            PreinvoiceLineId = line.Id, LineNumber = line.LineNumber,
            OperationCode = line.OperationCode, OperationDate = line.OperationDate,
            ServiceCode = line.ServiceCode, ServiceName = line.ServiceName,
            ExecutedQuantity = line.ExecutedQuantity, BillingUnit = line.BillingUnit,
            UnitPrice = line.UnitPrice, CurrencyCode = line.CurrencyCode,
            Amount = line.Amount, Kind = line.Kind,
            TaxPolicyPublicId = line.TaxPolicyPublicId, TaxTreatment = line.TaxTreatment,
            TaxRate = line.TaxRate, TaxBasis = line.TaxBasis, NetAmount = line.NetAmount,
            DiscountAmount = line.DiscountAmount, TaxAmount = line.TaxAmount,
            GrossAmount = line.GrossAmount, TaxCapturedAt = line.TaxCapturedAt,
            ParentLineNumber = parentLineNumber,
            Reason = line.Kind == PreinvoiceLineKind.Service ? null : line.AdjustmentReason,
            CreatedAt = now, UpdatedAt = now,
        };
    }
}

/// <summary>The calculation a service line of the internal draft keeps (<see cref="PreinvoiceLine.CalculationJson"/>).</summary>
internal static class PreinvoiceLineCalculation
{
    public static string Serialize(Guid servicePublicId, long? contractServiceRateId, decimal executedQuantity,
        string billingUnitSnapshot, decimal? unitPriceSnapshot, string? currencyCodeSnapshot, decimal amount) =>
        JsonSerializer.Serialize(new
        {
            ServicePublicId = servicePublicId, ContractServiceRateId = contractServiceRateId,
            ExecutedQuantity = executedQuantity, BillingUnitSnapshot = billingUnitSnapshot,
            UnitPriceSnapshot = unitPriceSnapshot, CurrencyCodeSnapshot = currencyCodeSnapshot, amount,
        });
}
