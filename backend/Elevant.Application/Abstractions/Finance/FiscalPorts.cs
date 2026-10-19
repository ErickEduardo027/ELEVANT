using Elevant.Application.Finance;
namespace Elevant.Application.Abstractions.Finance;

public interface IFinanceFiscalStore
{
    Task<FiscalResult> CreateAsync(Guid accountId, FiscalCreateInput input, CancellationToken cancellationToken = default);
    Task<FiscalResult> SimulateAsync(Guid accountId, Guid documentId, FiscalSimulateInput input, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<FiscalDocumentData>?> ListAsync(Guid accountId, Guid? stationId, int take, CancellationToken cancellationToken = default);
    Task<FiscalDocumentData?> GetAsync(Guid accountId, Guid documentId, CancellationToken cancellationToken = default);
    Task<FiscalDownload?> DownloadAsync(Guid accountId, Guid documentId, Guid artifactId, CancellationToken cancellationToken = default);
    Task<FiscalResult> ApplyCallbackAsync(Guid accountId, FiscalCallbackInput input, CancellationToken cancellationToken = default);
}
/// <summary>Private durable bytes. Implementations must preserve the exact input and never return a public URL.</summary>
public interface IFiscalArtifactArchive
{
    Task PutAsync(string key, byte[] content, CancellationToken cancellationToken = default);
    Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default);
}
public interface IFiscalArtifactBuilder
{
    IReadOnlyList<FiscalArchiveItem> Build(Guid documentId, string environment, string canonicalSnapshot);
}
public interface IFiscalProvider
{
    Task<FiscalProviderReply> SubmitAsync(FiscalProviderRequest request, CancellationToken cancellationToken = default);
}
/// <summary>Authenticates and parses the original bytes. No caller-supplied status is trusted.</summary>
public interface IFiscalCallbackAuthenticator
{
    Task<FiscalAuthenticatedCallback?> AuthenticateAsync(string environment, string credential, byte[] bytes,
        CancellationToken cancellationToken = default);
}
/// <summary>Reserved for a selected provider; no production signature implementation is registered.</summary>
public interface IFiscalSignature
{
    Task<byte[]> SignAsync(byte[] originalBytes, CancellationToken cancellationToken = default);
}
