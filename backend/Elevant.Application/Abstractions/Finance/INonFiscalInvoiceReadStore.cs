using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface INonFiscalInvoiceReadStore
{
    Task<NonFiscalInvoiceData?> GetForFinanceAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken = default);

    Task<NonFiscalInvoiceData?> GetForAirlineAsync(
        Guid organizationId, Guid preinvoiceId, CancellationToken cancellationToken = default);
}
