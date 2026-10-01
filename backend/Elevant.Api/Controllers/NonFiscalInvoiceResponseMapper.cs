using Elevant.Application.Finance;
using Elevant.Contracts.Finance;

namespace Elevant.Api.Controllers;

internal static class NonFiscalInvoiceResponseMapper
{
    public static NonFiscalInvoiceResponse Map(NonFiscalInvoiceData invoice) =>
        new(invoice.Id, invoice.PreinvoiceId, invoice.AirlineId, invoice.StationId,
            invoice.Number, "NonFiscal", invoice.CurrencyCode, invoice.Total,
            invoice.IssuedAt, invoice.Lines.Select(line => new NonFiscalInvoiceLineResponse(
                line.Id, line.LineNumber, line.OperationCode, line.OperationDate,
                line.ServiceCode, line.ServiceName, line.ExecutedQuantity,
                line.BillingUnit, line.UnitPrice, line.Amount)).ToArray());
}
