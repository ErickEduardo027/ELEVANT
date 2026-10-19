using Elevant.Application.Abstractions.Finance;
namespace Elevant.Persistence.Finance;

/// <summary>Uses the existing private financial bucket; no public links or storage keys cross HTTP.</summary>
internal sealed class FinanceFiscalPrivateArchive(IPrivateFinancialObjectStore objects) : IFiscalArtifactArchive
{
    public Task PutAsync(string key, byte[] content, CancellationToken cancellationToken = default) =>
        objects.PutAsync(key, content, cancellationToken);
    public Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default) =>
        objects.GetAsync(key, cancellationToken);
}
