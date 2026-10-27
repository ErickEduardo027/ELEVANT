using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinanceFiscalStore
{
    public async Task<FiscalResult> ApplyCallbackAsync(Guid accountId, FiscalCallbackInput input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (FinanceFiscalPolicy.ExecutionFailure(options) is { } disabled) return Fail(disabled);
        if (input.OriginalBytes is null || input.OriginalBytes.Length is < 1 or > 1048576 ||
            string.IsNullOrWhiteSpace(input.Credential) || input.Credential.Length > 4096) return Fail(FinanceFiscalFailure.Invalid);
        var actor = await ActorAsync(accountId, ["finance.fiscal.create", "finance.fiscal.simulate"], cancellationToken);
        if (actor is null) return Fail(FinanceFiscalFailure.Forbidden);
        // The authenticator parses the original bytes only after authentication. Default implementation always denies.
        var callback = await callbacks.AuthenticateAsync(options.Environment, input.Credential, input.OriginalBytes, cancellationToken);
        if (callback is null) return Fail(FinanceFiscalFailure.Forbidden);
        if (callback.Environment != options.Environment || callback.EventId == Guid.Empty || callback.Sequence <= 0 ||
            callback.Encf is not null || callback.DgiiResponseId is not null ||
            callback.ProviderDocumentId != $"SIM-{callback.DocumentId:N}" ||
            callback.State is not (FiscalState.Accepted or FiscalState.Rejected or FiscalState.Conditional or FiscalState.Pending or FiscalState.Unknown))
            return Fail(FinanceFiscalFailure.Invalid);
        var document = await Documents(actor).AsNoTracking().SingleOrDefaultAsync(d => d.PublicId == callback.DocumentId, cancellationToken);
        if (document is null) return Fail(FinanceFiscalFailure.NotFound);
        var hash = FinanceFiscalPolicy.Hash(input.OriginalBytes);
        var prior = await context.Set<FinanceFiscalEvent>().AsNoTracking().SingleOrDefaultAsync(e =>
            e.DocumentId == document.Id && e.EventId == callback.EventId, cancellationToken);
        if (prior is not null) return prior.PayloadHash == hash ? Success(document, true) : Fail(FinanceFiscalFailure.Conflict);
        if (!await context.Set<FinanceFiscalIntent>().AnyAsync(i => i.DocumentId == document.Id && i.DispatchCount == 1, cancellationToken))
            return Fail(FinanceFiscalFailure.Conflict);
        IReadOnlyList<FinanceFiscalArtifact> archived;
        try
        {
            archived = await ArchiveAsync(new(document.Id, document.PublicId, document.Environment, document.Outcome,
                document.CanonicalSnapshot, document.SnapshotHash), [new(FiscalArtifactKind.Callback,
                    $"callback-{callback.EventId:N}.bin", "application/octet-stream", input.OriginalBytes)], cancellationToken);
        }
        catch (Exception e) when (ArchiveFailure(e)) { return Fail(FinanceFiscalFailure.ArchiveUnavailable); }
        return await WriteAsync(accountId, async (freshActor, key) =>
        {
            var visible = await Documents(freshActor).AsNoTracking().SingleOrDefaultAsync(d => d.PublicId == callback.DocumentId, cancellationToken);
            if (visible is null) return Fail(FinanceFiscalFailure.NotFound);
            var current = await LockAsync(visible.Id, cancellationToken);
            var duplicate = await context.Set<FinanceFiscalEvent>().SingleOrDefaultAsync(e =>
                e.DocumentId == current.Id && e.EventId == callback.EventId, cancellationToken);
            if (duplicate is not null) return duplicate.PayloadHash == hash ? Success(current, true) : Fail(FinanceFiscalFailure.Conflict);
            await AddArtifactsAsync(archived, cancellationToken);
            var applies = FinanceFiscalPolicy.CanApply(current.State, callback.State, current.LastProviderSequence, callback.Sequence);
            if (applies)
            {
                current.State = callback.State; current.LastProviderSequence = callback.Sequence;
                current.ProviderDocumentId = callback.ProviderDocumentId;
                var originals = await context.Set<FinanceFiscalArtifact>().Where(a => a.DocumentId == current.Id &&
                    (a.Kind == FiscalArtifactKind.CanonicalJson || a.Kind == FiscalArtifactKind.SimulationXml || a.Kind == FiscalArtifactKind.Manifest))
                    .Select(a => a.Kind).Distinct().CountAsync(cancellationToken);
                current.ArtifactCompletion = originals == 3 ? FiscalArtifactCompletion.Complete : FiscalArtifactCompletion.Failed;
                var intent = await context.Set<FinanceFiscalIntent>().SingleAsync(i => i.DocumentId == current.Id, cancellationToken);
                intent.Status = FiscalIntentStatus.Completed; intent.UpdatedAt = Now;
            }
            Event(current, applies ? "CallbackApplied" : "CallbackIgnored",
                applies ? "Authenticated callback archived and applied." : "Authenticated duplicate-order or terminal-state callback archived without state change.",
                applies, callback.EventId, callback.Sequence, hash, callback.State);
            Audit(key, current, applies ? "callback.applied" : "callback.ignored", callback.EventId);
            await context.SaveChangesAsync(cancellationToken);
            return Success(current);
        }, cancellationToken);
    }
}
