namespace Elevant.Application.Abstractions.Commercial;

public sealed record MediaAssetData(Guid Id, string Url, string Purpose, string ContentType, long Length);

public sealed record MediaContentData(string ObjectKey, string ContentType, long Length);

public interface ICommercialMediaStore
{
    Task<MediaAssetData?> UploadAsync(Guid actorId, string purpose, string contentType,
        Stream content, long length, CancellationToken cancellationToken = default);
    Task<MediaContentData?> GetReadableAsync(Guid id, Guid? actorId = null,
        CancellationToken cancellationToken = default);
    Task<Stream> OpenAsync(string key, long? start = null, long? last = null,
        CancellationToken cancellationToken = default);
    Task<int> CleanupOrphansAsync(CancellationToken cancellationToken = default);
}
