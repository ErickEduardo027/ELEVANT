using Elevant.Application.Operations;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Whether the operation's current Service Order is the one the airline and AVIAM signed (3-N02, ADR-0032):
/// <see cref="ServiceOrderStates.FullySigned"/> when a version with the current content carries every required signature,
/// <see cref="ServiceOrderStates.Corrected"/> when OCC adjusted a signed order after the signature (the current version
/// names, through <see cref="OperationDocumentVersion.CorrectsVersionId"/>, a fully signed one),
/// <see cref="ServiceOrderStates.Stale"/> when it was signed but its content changed since, and
/// <see cref="ServiceOrderStates.NeverSigned"/> when it was never fully signed. OCC approves only a signed or corrected
/// order, and every OCC adjustment of a signed order is recorded here as a corrected version with its reason.
/// </summary>
internal static class ServiceOrderSignatures
{
    /// <summary>The state of the current Service Order and the versions it stands on.</summary>
    /// <param name="State">One of <see cref="ServiceOrderStates"/>.</param>
    /// <param name="Content">The current content, as assembled now.</param>
    /// <param name="ContentSha256">The SHA-256 of its canonical JSON.</param>
    /// <param name="CurrentVersionId">The stored version with the current content, when there is one.</param>
    /// <param name="SignedVersionId">The fully signed version the current one is (Signed) or corrects (Corrected).</param>
    internal sealed record Evaluation(string State, OperationDocumentContent? Content, string? ContentSha256,
        long? CurrentVersionId, long? SignedVersionId)
    {
        public bool CanBeApproved => State is ServiceOrderStates.FullySigned or ServiceOrderStates.Corrected;
    }

    /// <summary>A correction OCC made after the signature, as the forms print it.</summary>
    internal sealed record Correction(string Reason, DateTimeOffset CorrectedAt, string CorrectedBy);

    private sealed record VersionRow(long Id, string ContentSha256, long? CorrectsVersionId);

    public static async Task<Evaluation> EvaluateAsync(ElevantDbContext context, long operationId,
        TimeProvider? timeProvider, CancellationToken cancellationToken)
    {
        var assembled = await new OperationDocumentAssembler(context, timeProvider).AssembleAsync(operationId,
            cancellationToken);
        var content = assembled?.Documents.SingleOrDefault(item => item.Kind == OperationDocumentKind.ServiceOrder);
        if (content is null) return new Evaluation(ServiceOrderStates.NeverSigned, null, null, null, null);
        var sha = OperationDocumentRules.Sha256Of(OperationDocumentRules.CanonicalJson(content));
        var versions = await context.Set<OperationDocumentVersion>().AsNoTracking()
            .Where(item => item.GroundOperationId == operationId && item.Kind == OperationDocumentKind.ServiceOrder)
            .Select(item => new VersionRow(item.Id, item.ContentSha256, item.CorrectsVersionId))
            .ToArrayAsync(cancellationToken);
        var ids = versions.Select(item => item.Id).ToArray();
        var signed = (await context.Set<OperationDocumentSignature>().AsNoTracking()
                .Where(item => ids.Contains(item.OperationDocumentVersionId))
                .Select(item => new { item.OperationDocumentVersionId, item.Role })
                .ToArrayAsync(cancellationToken))
            .GroupBy(item => item.OperationDocumentVersionId)
            .Where(group => OperationDocumentRules.RolesFor(OperationDocumentKind.ServiceOrder)
                .All(role => group.Any(item => item.Role == role)))
            .Select(group => group.Key).ToHashSet();
        var current = versions.SingleOrDefault(item => item.ContentSha256 == sha);
        if (current is not null)
        {
            if (signed.Contains(current.Id))
                return new Evaluation(ServiceOrderStates.FullySigned, content, sha, current.Id, current.Id);
            if (SignedAncestor(current, versions, signed) is long ancestor)
                return new Evaluation(ServiceOrderStates.Corrected, content, sha, current.Id, ancestor);
        }
        return new Evaluation(signed.Count > 0 ? ServiceOrderStates.Stale : ServiceOrderStates.NeverSigned, content, sha,
            current?.Id, null);
    }

    /// <summary>
    /// After an OCC adjustment (a charge added or removed, a service excluded from billing or included again) of a
    /// Service Order that was signed or already corrected (<paramref name="before"/>), stores the new content as a
    /// version that corrects the one OCC changed, with the reason, the account and the time. When the content already
    /// has its version (OCC went back to what was signed) nothing new is written. The caller's adjustment is saved
    /// first so the new content reads it.
    /// </summary>
    public static async Task RecordCorrectionAsync(ElevantDbContext context, long operationId, Evaluation before,
        string reason, long accountId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (!before.CanBeApproved || before.CurrentVersionId is not long previous) return;
        await context.SaveChangesAsync(cancellationToken);
        var after = await EvaluateAsync(context, operationId, null, cancellationToken);
        if (after.Content is null || after.ContentSha256 is null || after.ContentSha256 == before.ContentSha256) return;
        var note = reason.Length <= 500 ? reason : reason[..500];
        var existing = await context.Set<OperationDocumentVersion>().SingleOrDefaultAsync(item =>
            item.GroundOperationId == operationId && item.Kind == OperationDocumentKind.ServiceOrder &&
            item.ContentSha256 == after.ContentSha256, cancellationToken);
        if (existing is null)
        {
            context.Add(new OperationDocumentVersion
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operationId, Kind = OperationDocumentKind.ServiceOrder,
                DocumentNumber = after.Content.Number, ContentJson = OperationDocumentRules.CanonicalJson(after.Content),
                ContentSha256 = after.ContentSha256, CorrectsVersionId = previous, CorrectionReason = note,
                CorrectedByAccountId = accountId, CorrectedAt = now, CreatedAt = now, UpdatedAt = now,
            });
        }
        else if (!after.CanBeApproved && existing.CorrectsVersionId is null && existing.Id != previous)
        {
            // An earlier content nobody fully signed comes back with OCC's adjustment: the correction names it.
            existing.CorrectsVersionId = previous;
            existing.CorrectionReason = note;
            existing.CorrectedByAccountId = accountId;
            existing.CorrectedAt = now;
            existing.UpdatedAt = now;
        }
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// The corrections a version carries back to the signed one it stands on, oldest first: what the airline's copy
    /// and the PDF print as «Corregida por OCC después de la firma».
    /// </summary>
    public static async Task<IReadOnlyList<Correction>> CorrectionsAsync(ElevantDbContext context, long versionId,
        CancellationToken cancellationToken)
    {
        var corrections = new List<Correction>();
        var visited = new HashSet<long>();
        long? cursor = versionId;
        while (cursor is long id && visited.Add(id))
        {
            var row = await context.Set<OperationDocumentVersion>().AsNoTracking()
                .Where(version => version.Id == id)
                .Select(version => new { version.CorrectsVersionId, version.CorrectionReason, version.CorrectedAt,
                    version.CorrectedByAccountId })
                .SingleOrDefaultAsync(cancellationToken);
            if (row?.CorrectsVersionId is null) break;
            corrections.Add(new Correction(row.CorrectionReason ?? string.Empty, row.CorrectedAt!.Value,
                await AccountDisplayNames.OfAsync(context, row.CorrectedByAccountId, cancellationToken)));
            cursor = row.CorrectsVersionId;
        }
        corrections.Reverse();
        return corrections;
    }

    private static long? SignedAncestor(VersionRow current, IReadOnlyList<VersionRow> versions, HashSet<long> signed)
    {
        var visited = new HashSet<long> { current.Id };
        var cursor = current;
        while (cursor.CorrectsVersionId is long previous && visited.Add(previous))
        {
            cursor = versions.SingleOrDefault(item => item.Id == previous);
            if (cursor is null) return null;
            if (signed.Contains(cursor.Id)) return cursor.Id;
        }
        return null;
    }
}
