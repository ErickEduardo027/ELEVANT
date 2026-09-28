namespace Elevant.Persistence.Finance;

/// <summary>Private S3 bytes only; SQL owns the financial-document metadata.</summary>
internal interface IPrivateFinancialObjectStore
{
    Task PutAsync(string key, byte[] content, CancellationToken cancellationToken = default);
    Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default);
    Task DeleteAsync(string key, CancellationToken cancellationToken = default);
}
