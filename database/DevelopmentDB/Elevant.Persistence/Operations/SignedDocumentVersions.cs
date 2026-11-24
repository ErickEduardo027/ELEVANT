using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// CN-27: which stored version of a form the content assembled now stands on. A version matches when its hash is the
/// current one or when it attests the same operational facts (<see cref="OperationDocumentSignedFacts"/>): a renamed
/// station, airline, aircraft model or service keeps the signatures. Every reader of the signature state (the
/// tablet and OCC views, the signing itself, OCC's approval and the airline's copy) resolves it here, so they agree.
/// </summary>
internal static class SignedDocumentVersions
{
    internal sealed record Stored(long Id, OperationDocumentKind Kind, string ContentSha256, string ContentJson,
        long? CorrectsVersionId);

    public static Task<Stored[]> ReadAsync(ElevantDbContext context, long operationId, OperationDocumentKind? kind,
        CancellationToken cancellationToken) =>
        context.Set<OperationDocumentVersion>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId && (kind == null || item.Kind == kind))
            .OrderBy(item => item.Id)
            .Select(item => new Stored(item.Id, item.Kind, item.ContentSha256, item.ContentJson, item.CorrectsVersionId))
            .ToArrayAsync(cancellationToken);

    /// <summary>The versions of the content's form that attest the same facts as it, the exact hash first.</summary>
    public static IReadOnlyList<Stored> SameFacts(OperationDocumentContent content, string contentSha256,
        IEnumerable<Stored> versions)
    {
        var facts = OperationDocumentSignedFacts.Facts(content);
        return versions
            .Where(item => item.Kind == content.Kind &&
                           OperationDocumentSignedFacts.Matches(item.ContentSha256, item.ContentJson, contentSha256, facts))
            .OrderByDescending(item => item.ContentSha256 == contentSha256).ThenByDescending(item => item.Id)
            .ToArray();
    }

    /// <summary>
    /// The version a reader sees and a signer signs: among those with the same facts, the fully signed one, else the
    /// one with most signatures, else the exact one, else the latest; null when none matches (the content is new).
    /// </summary>
    public static Stored? Presented(IReadOnlyList<Stored> sameFacts, OperationDocumentKind kind,
        Func<long, IReadOnlyCollection<OperationSignatureRole>> signedRoles)
    {
        var required = OperationDocumentRules.RolesFor(kind);
        return sameFacts
            .Select((item, order) => (item, order, roles: signedRoles(item.Id)))
            .OrderByDescending(entry => required.All(role => entry.roles.Contains(role)))
            .ThenByDescending(entry => entry.roles.Count)
            .ThenBy(entry => entry.order)
            .Select(entry => entry.item)
            .FirstOrDefault();
    }
}
