using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface INonFiscalInvoiceReadStore
{
    Task<NonFiscalInvoiceData?> GetForFinanceAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken = default);

    Task<NonFiscalInvoiceData?> GetForAirlineAsync(
        Guid organizationId, Guid preinvoiceId, CancellationToken cancellationToken = default);

    /// <summary>ADR-0035: invoices are addressed by their own id; returns the internal draft that keeps its lines.</summary>
    Task<Guid?> PreinvoiceOfInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
        Task.FromResult<Guid?>(null);
}
