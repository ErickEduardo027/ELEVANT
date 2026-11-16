using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Operations;

namespace Elevant.Application.Commercial;

/// <summary>
/// The airline portal sees the Service Order its representative signed on the ramp (ADR-0032), drawn from the stored
/// snapshot and scoped to its organization: the current one when it is signed, or corrected by OCC after the signature
/// with the correction printed (3-N02); otherwise the latest fully signed one.
/// </summary>
public sealed class AirlineServiceOrderHandler(IActorContextResolver actors, IOperationDocumentStore documents,
    IOperationDocumentPdfRenderer renderer)
{
    public async Task<(SignedOperationDocument? Document, AirlinePortalFailure? Failure)> GetAsync(Guid accountId,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        if (operationId == Guid.Empty) return (null, AirlinePortalFailure.NotFound);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return (null, failure);
        var document = await documents.ReadSignedServiceOrderForAirlineAsync(organizationId!.Value, operationId,
            cancellationToken);
        return document is null ? (null, AirlinePortalFailure.NotFound) : (document, null);
    }

    public async Task<(byte[]? Pdf, string? FileName, AirlinePortalFailure? Failure)> RenderAsync(Guid accountId,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        var (document, failure) = await GetAsync(accountId, operationId, cancellationToken);
        return document is null
            ? (null, null, failure)
            : (renderer.Render(document.Content, document.ContentSha256, document.Signatures,
                new Dictionary<Guid, DamagePhoto>(), document.Corrections), OperationDocumentHandler.FileName(document.Content),
                null);
    }
}
