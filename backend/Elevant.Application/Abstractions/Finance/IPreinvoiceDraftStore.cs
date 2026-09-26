using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IPreinvoiceDraftStore
{
    Task<PreinvoiceDraftResult> CreateAsync(
        CreatePreinvoiceDraftCommand request,
        CancellationToken cancellationToken = default);

    Task<PreinvoiceDraftDetail?> GetAsync(
        Guid accountId, Guid draftId,
        CancellationToken cancellationToken = default);
}
