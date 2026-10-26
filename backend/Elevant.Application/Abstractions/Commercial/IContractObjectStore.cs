namespace Elevant.Application.Abstractions.Commercial;

/// <summary>Private, content-addressed contract bytes; object keys never leave the API.</summary>
public interface IContractObjectStore
{
    Task PutAsync(string key, byte[] bytes, CancellationToken cancellationToken = default);
    Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default);
}
