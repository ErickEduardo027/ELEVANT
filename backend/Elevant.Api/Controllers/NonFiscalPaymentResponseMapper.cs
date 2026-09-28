using Elevant.Application.Finance;
using Elevant.Contracts.Finance;

namespace Elevant.Api.Controllers;

internal static class NonFiscalPaymentResponseMapper
{
    public static NonFiscalPaymentLookupResponse Map(NonFiscalPaymentLookupData lookup) =>
        new(lookup.InvoiceId, lookup.Payment is null ? null : new NonFiscalPaymentResponse(
            lookup.Payment.Id, lookup.Payment.InvoiceId, lookup.Payment.Reference,
            lookup.Payment.CurrencyCode, lookup.Payment.Amount, lookup.Payment.RecordedAt));
}
