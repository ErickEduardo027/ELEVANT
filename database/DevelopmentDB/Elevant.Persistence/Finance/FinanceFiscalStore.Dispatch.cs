using System.Text;
using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class FinanceFiscalStore
{
    private sealed record DispatchWork(long Id, Guid PublicId, string Environment, FiscalSimulationOutcome Outcome,
        string Snapshot, string SnapshotHash);

    public async Task<FiscalResult> SimulateAsync(Guid accountId, Guid documentId, FiscalSimulateInput input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (FinanceFiscalPolicy.ExecutionFailure(options) is { } disabled) return Fail(disabled);
        if (documentId == Guid.Empty || input.RequestId == Guid.Empty || !ValidVersion(input.ExpectedVersion))
            return Fail(FinanceFiscalFailure.Invalid);
        var hash = FinanceFiscalPolicy.Hash(JsonSerializer.Serialize(new { accountId, documentId, input.RequestId, input.ExpectedVersion, options.Environment }));
        DispatchWork? work = null;
        var started = await WriteAsync(accountId, async (actor, key) =>
        {
            var visible = await Documents(actor).AsNoTracking().SingleOrDefaultAsync(d => d.PublicId == documentId, cancellationToken);
            if (visible is null) return Fail(FinanceFiscalFailure.NotFound);
            var document = await LockAsync(visible.Id, cancellationToken);
            var intent = await context.Set<FinanceFiscalIntent>().SingleAsync(i => i.DocumentId == document.Id, cancellationToken);
            var priorRequest = await context.Set<FinanceFiscalEvent>().AsNoTracking().SingleOrDefaultAsync(e =>
                e.DocumentId == document.Id && e.EventId == input.RequestId, cancellationToken);
            if (priorRequest is not null)
                return priorRequest.Kind == "Archiving" && priorRequest.PayloadHash == hash
                    ? Success(document, true) : Fail(FinanceFiscalFailure.Conflict);
            if (intent.DispatchRequestId == input.RequestId)
                return intent.DispatchRequestHash == hash && intent.DispatchedByAccountId == key
                    ? Success(document, true) : Fail(FinanceFiscalFailure.Conflict);
            if (Version(document) != input.ExpectedVersion || document.Mode != options.Mode || intent.DispatchCount != 0 ||
                !FinanceFiscalPolicy.CanDispatch(document.State)) return Fail(FinanceFiscalFailure.Conflict);
            if (await context.Set<FinanceFiscalIntent>().AnyAsync(i => i.DispatchRequestId == input.RequestId, cancellationToken))
                return Fail(FinanceFiscalFailure.Conflict);
            if (FinanceFiscalPolicy.Hash(document.CanonicalSnapshot) != document.SnapshotHash)
                return Fail(FinanceFiscalFailure.Conflict);
            intent.DispatchRequestId = input.RequestId; intent.DispatchRequestHash = hash; intent.DispatchedByAccountId = key;
            intent.Status = FiscalIntentStatus.Archiving; intent.UpdatedAt = Now;
            document.State = FiscalState.Archiving; document.ArtifactCompletion = FiscalArtifactCompletion.Pending;
            Event(document, "Archiving", "Archiving original canonical JSON, simulation XML and manifest before dispatch.",
                eventId: input.RequestId, hash: hash);
            Audit(key, document, "archive.started", input.RequestId);
            await context.SaveChangesAsync(cancellationToken);
            work = new(document.Id, document.PublicId, document.Environment, document.Outcome, document.CanonicalSnapshot, document.SnapshotHash);
            return Success(document);
        }, cancellationToken);
        if (!started.IsSuccess || started.Replayed || work is null) return started;

        IReadOnlyList<FinanceFiscalArtifact> originals;
        try
        {
            originals = await ArchiveAsync(work, artifactBuilder.Build(work.PublicId, work.Environment, work.Snapshot), cancellationToken);
        }
        catch (Exception)
        {
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            return await ArchiveBlockedAsync(accountId, work.PublicId, input.RequestId, cleanup.Token);
        }
        // Commit the dispatch claim before calling the adapter. A crash or timeout after this point is never blindly resent.
        var claimed = await WriteAsync(accountId, async (actor, key) =>
        {
            var visible = await Documents(actor).AsNoTracking().SingleOrDefaultAsync(d => d.PublicId == documentId, cancellationToken);
            if (visible is null) return Fail(FinanceFiscalFailure.NotFound);
            var document = await LockAsync(visible.Id, cancellationToken);
            var intent = await context.Set<FinanceFiscalIntent>().SingleAsync(i => i.DocumentId == document.Id, cancellationToken);
            if (intent.DispatchRequestId != input.RequestId || intent.Status != FiscalIntentStatus.Archiving || intent.DispatchCount != 0)
                return Fail(FinanceFiscalFailure.Conflict);
            await AddArtifactsAsync(originals, cancellationToken);
            intent.Status = FiscalIntentStatus.Dispatching; intent.DispatchCount = 1; intent.DispatchedAt = Now; intent.UpdatedAt = Now;
            document.State = FiscalState.Dispatching;
            Event(document, "DispatchClaimed", "Original artifacts verified; one local simulation dispatch claimed.");
            Audit(key, document, "dispatch.claimed", input.RequestId);
            await context.SaveChangesAsync(cancellationToken);
            return Success(document);
        }, cancellationToken);
        if (!claimed.IsSuccess) return claimed;

        FiscalProviderReply? reply = null;
        FinanceFiscalArtifact? responseArtifact = null;
        var responseArchiveFailed = false;
        try
        {
            reply = await provider.SubmitAsync(new(work.PublicId, work.Environment, work.Outcome, Encoding.UTF8.GetBytes(work.Snapshot)), cancellationToken);
            if (!ValidReply(reply)) reply = null;
        }
        catch (Exception) { /* Persist Unknown after any uncertain adapter completion; never resend. */ }
        if (reply is not null)
        {
            try
            {
                responseArtifact = (await ArchiveAsync(work,
                    [new(FiscalArtifactKind.ProviderResponse, "simulation-response.json", "application/json", reply.OriginalBytes)], cancellationToken)).Single();
            }
            catch (Exception) { responseArchiveFailed = true; }
        }
        // Persist the uncertain outcome even when the HTTP caller cancels after the dispatch claim.
        using var completion = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var completionToken = completion.Token;
        return await WriteAsync(accountId, async (actor, key) =>
        {
            var visible = await Documents(actor).AsNoTracking().SingleOrDefaultAsync(d => d.PublicId == documentId, completionToken);
            if (visible is null) return Fail(FinanceFiscalFailure.NotFound);
            var document = await LockAsync(visible.Id, completionToken);
            var intent = await context.Set<FinanceFiscalIntent>().SingleAsync(i => i.DocumentId == document.Id, completionToken);
            if (intent.DispatchRequestId != input.RequestId || intent.DispatchCount != 1) return Fail(FinanceFiscalFailure.Conflict);
            if (responseArtifact is not null) await AddArtifactsAsync([responseArtifact], completionToken);
            if (document.LastProviderSequence == 0)
            {
                document.State = reply is not null && !responseArchiveFailed ? reply.State : FiscalState.Unknown;
                document.LastProviderSequence = reply?.Sequence ?? 1;
                document.ProviderDocumentId = reply?.ProviderDocumentId;
            }
            document.ArtifactCompletion = responseArtifact is not null ? FiscalArtifactCompletion.Complete : FiscalArtifactCompletion.Failed;
            intent.Status = FiscalIntentStatus.Completed; intent.UpdatedAt = Now;
            Event(document, responseArchiveFailed ? "ResponseArchiveFailed" : "SimulationCompleted",
                responseArchiveFailed ? "Response archive incomplete; state is unknown and dispatch cannot be repeated." :
                "Local simulation completed. Timeout and uncertain results must be reconciled without resend.", sequence: reply?.Sequence);
            Audit(key, document, "simulation.completed", input.RequestId);
            await context.SaveChangesAsync(completionToken);
            return Success(document);
        }, completionToken);
    }
    private static bool ValidReply(FiscalProviderReply reply) => reply.Sequence > 0 && reply.OriginalBytes.Length is > 0 and <= 1048576 &&
        reply.ProviderDocumentId is { Length: <= 160 } id && id.StartsWith("SIM-", StringComparison.Ordinal) &&
        reply.DgiiResponseId is null && reply.Encf is null &&
        reply.State is FiscalState.Accepted or FiscalState.Rejected or FiscalState.Conditional or FiscalState.Pending or FiscalState.Unknown;

    private Task<FiscalResult> ArchiveBlockedAsync(Guid account, Guid documentId, Guid requestId, CancellationToken ct) =>
        WriteAsync(account, async (actor, key) =>
        {
            var visible = await Documents(actor).AsNoTracking().SingleOrDefaultAsync(d => d.PublicId == documentId, ct);
            if (visible is null) return Fail(FinanceFiscalFailure.NotFound);
            var document = await LockAsync(visible.Id, ct);
            var intent = await context.Set<FinanceFiscalIntent>().SingleAsync(i => i.DocumentId == document.Id, ct);
            if (intent.DispatchRequestId != requestId || intent.DispatchCount != 0) return Fail(FinanceFiscalFailure.Conflict);
            document.State = FiscalState.ArchiveBlocked; document.ArtifactCompletion = FiscalArtifactCompletion.Failed;
            intent.Status = FiscalIntentStatus.ArchiveBlocked; intent.UpdatedAt = Now;
            Event(document, "ArchiveBlocked", "Original artifact archive or readback failed; dispatch blocked.");
            Audit(key, document, "archive.blocked", requestId);
            await context.SaveChangesAsync(ct);
            return new(document.PublicId, Version(document), false, FinanceFiscalFailure.ArchiveUnavailable);
        }, ct);

    private async Task<IReadOnlyList<FinanceFiscalArtifact>> ArchiveAsync(DispatchWork work,
        IReadOnlyList<FiscalArchiveItem> items, CancellationToken ct)
    {
        var result = new List<FinanceFiscalArtifact>();
        foreach (var item in items)
        {
            if (item.Bytes.Length == 0) throw new IOException("Artifact was empty.");
            var hash = FinanceFiscalPolicy.Hash(item.Bytes);
            var objectKey = $"finance/fiscal/{work.Environment}/{work.PublicId:N}/{item.Kind}/{hash}";
            var prior = await archive.GetAsync(objectKey, ct);
            if (prior is null) await archive.PutAsync(objectKey, item.Bytes, ct);
            var verified = prior ?? await archive.GetAsync(objectKey, ct);
            if (verified is null || !verified.AsSpan().SequenceEqual(item.Bytes)) throw new IOException("Archive readback integrity failed.");
            result.Add(new FinanceFiscalArtifact { PublicId = Guid.CreateVersion7(), DocumentId = work.Id,
                Kind = item.Kind, ObjectKey = objectKey, ContentType = item.ContentType, FileName = item.FileName,
                Sha256 = hash, Length = item.Bytes.LongLength, CreatedAt = Now, UpdatedAt = Now });
        }
        return result;
    }
    private async Task AddArtifactsAsync(IReadOnlyList<FinanceFiscalArtifact> artifacts, CancellationToken ct)
    {
        foreach (var artifact in artifacts)
            if (!await context.Set<FinanceFiscalArtifact>().AnyAsync(a => a.ObjectKey == artifact.ObjectKey, ct)) context.Add(artifact);
    }
}
