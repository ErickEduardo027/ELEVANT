using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Operations;

namespace Elevant.Application.Commercial;

/// <summary>
/// The airline portal downloads the Flight Report of its own operation once OCC approved it (ADR-0031/0032): the
/// organization comes from the session's membership and the stations from those its contracts cover, so an operation of
/// another airline or station is a 404. Walk-around photos stay internal.
/// </summary>
public sealed class AirlineFlightReportHandler(IActorContextResolver actors, IAirlinePortalReportStore portal,
    IOperationDocumentStore documents, IOperationDocumentPdfRenderer renderer)
{
    public async Task<(byte[]? Pdf, string? FileName, AirlinePortalFailure? Failure)> RenderAsync(Guid accountId,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return (null, null, failure);
        if (operationId == Guid.Empty) return (null, null, AirlinePortalFailure.NotFound);
        var profile = await portal.ProfileAsync(organizationId!.Value, cancellationToken);
        var stations = profile?.Stations.Select(station => station.Id).Where(id => id != Guid.Empty).Distinct().ToArray() ?? [];
        if (stations.Length == 0) return (null, null, AirlinePortalFailure.NotFound);
        var document = await documents.ReadApprovedFlightReportForAirlineAsync(organizationId.Value, stations, operationId,
            cancellationToken);
        return document is null
            ? (null, null, AirlinePortalFailure.NotFound)
            : (renderer.Render(document.Content, document.ContentSha256, document.Signatures, new Dictionary<Guid, DamagePhoto>()),
                OperationDocumentHandler.FileName(document.Content), null);
    }
}
