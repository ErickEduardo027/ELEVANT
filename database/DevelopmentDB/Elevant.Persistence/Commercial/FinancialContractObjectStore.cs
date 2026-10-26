using Elevant.Application.Abstractions.Commercial;
using Elevant.Persistence.Finance;

namespace Elevant.Persistence.Commercial;

/// <summary>Uses the existing private S3 adapter for Adobe-backed contracts.</summary>
internal sealed class FinancialContractObjectStore(IPrivateFinancialObjectStore inner)
    : IContractObjectStore
{
    public Task PutAsync(string key, byte[] bytes,
        CancellationToken cancellationToken = default) =>
        inner.PutAsync(key, bytes, cancellationToken);

    public Task<byte[]?> GetAsync(string key,
        CancellationToken cancellationToken = default) =>
        inner.GetAsync(key, cancellationToken);
}
