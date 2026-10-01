using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface INonFiscalPaymentReadStore
{
    Task<NonFiscalPaymentLookupData?> GetForFinanceAsync(
        Guid accountId, Guid invoiceId, CancellationToken cancellationToken = default);

    Task<NonFiscalPaymentLookupData?> GetForAirlineAsync(
        Guid organizationId, Guid invoiceId, CancellationToken cancellationToken = default);
}
