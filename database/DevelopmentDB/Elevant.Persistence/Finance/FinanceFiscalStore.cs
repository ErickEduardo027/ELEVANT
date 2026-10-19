using System.Data;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>Bounded persistent fiscal sidecar. No invoice/ledger writes, background jobs or external fiscal transport.</summary>
internal sealed partial class FinanceFiscalStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider, FinanceFiscalOptions options, IFiscalArtifactArchive archive,
    IFiscalProvider provider, IFiscalCallbackAuthenticator callbacks, IFiscalArtifactBuilder artifactBuilder) : IFinanceFiscalStore
{
    private sealed class InvoiceScope
    {
        public NonFiscalInvoice Invoice { get; init; } = null!;
        public Guid StationId { get; init; }
        public long OrganizationId { get; init; }
    }
    private static FiscalResult Fail(FinanceFiscalFailure failure) => FiscalResult.Failed(failure);
    private static string Version(FinanceFiscalDocument document) => Convert.ToBase64String(document.RowVersion);
    private static FiscalResult Success(FinanceFiscalDocument document, bool replayed = false) => new(document.PublicId, Version(document), replayed, null);
    private DateTimeOffset Now => timeProvider.GetUtcNow();

    private async Task<ActorContext?> ActorAsync(Guid account, string[] permissions, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(account, ct);
        return actor is not null && permissions.All(actor.HasPermission) && actor.Memberships.Any(m =>
            m.OrganizationType == OrganizationType.AviamOperator && m.Kind == MembershipKind.InternalStaff) ? actor : null;
    }
    private IQueryable<InvoiceScope> Invoices(ActorContext actor)
    {
        var allowed = actor.StationScopes.Select(s => s.StationId).ToArray();
        var now = Now;
        return from i in context.Set<NonFiscalInvoice>()
               join station in context.Stations on i.StationId equals station.Id
               join airline in context.Airlines on i.AirlineId equals airline.Id
               join organization in context.Organizations on airline.OrganizationId equals organization.Id
               where allowed.Contains(station.PublicId) && station.IsActive && airline.IsActive &&
                   organization.Type == OrganizationType.AirlineCustomer && organization.Status == OrganizationStatus.Active &&
                   context.Users.Any(u => u.PublicId == actor.AccountId && context.AccountStationScopes.Any(g =>
                       g.AccountId == u.Id && g.StationId == station.Id && g.GrantedAt <= now && g.RevokedAt == null))
               select new InvoiceScope { Invoice = i, StationId = station.PublicId, OrganizationId = organization.Id };
    }
    private IQueryable<FinanceFiscalDocument> Documents(ActorContext actor) =>
        from d in context.Set<FinanceFiscalDocument>()
        join scope in Invoices(actor) on d.InvoiceId equals scope.Invoice.Id
        where d.Environment == options.Environment
        select d;
    private Task<FinanceFiscalDocument> LockAsync(long id, CancellationToken ct) =>
        context.Set<FinanceFiscalDocument>().FromSqlInterpolated(
            $"SELECT * FROM [commercial].[finance_fiscal_documents] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = {id}").SingleAsync(ct);

    private async Task<FiscalResult> WriteAsync(Guid account, Func<ActorContext, long, Task<FiscalResult>> action, CancellationToken ct)
    {
        try
        {
            return await context.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var actor = await ActorAsync(account, ["finance.fiscal.manage", "finance.fiscal.simulate"], ct);
                if (actor is null) return Fail(FinanceFiscalFailure.Forbidden);
                var key = await context.Users.Where(u => u.PublicId == account).Select(u => (long?)u.Id).SingleOrDefaultAsync(ct);
                if (key is null) return Fail(FinanceFiscalFailure.Forbidden);
                var result = await action(actor, key.Value);
                await tx.CommitAsync(ct);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException) { context.ChangeTracker.Clear(); return Fail(FinanceFiscalFailure.Conflict); }
        catch (DbUpdateException e) when (IsConflict(e.GetBaseException()))
        { context.ChangeTracker.Clear(); return Fail(FinanceFiscalFailure.Conflict); }
        catch (SqlException e) when (IsConflict(e))
        { context.ChangeTracker.Clear(); return Fail(FinanceFiscalFailure.Conflict); }
        catch (RetryLimitExceededException e) when (IsConflict(e.GetBaseException()))
        { context.ChangeTracker.Clear(); return Fail(FinanceFiscalFailure.Conflict); }
    }
    private static bool IsConflict(Exception e) => e is SqlException s && s.Number is 1205 or 2601 or 2627 or 3960;

    private void Event(FinanceFiscalDocument document, string kind, string detail, bool applied = true,
        Guid? eventId = null, long? sequence = null, string? hash = null, FiscalState? state = null)
    {
        context.Add(new FinanceFiscalEvent { PublicId = Guid.CreateVersion7(), DocumentId = document.Id,
            EventId = eventId ?? Guid.CreateVersion7(), Kind = kind, Detail = detail, Applied = applied,
            State = state ?? document.State, ProviderSequence = sequence, PayloadHash = hash ?? document.SnapshotHash,
            CreatedAt = Now, UpdatedAt = Now });
        document.UpdatedAt = Now;
    }
    private void Audit(long account, FinanceFiscalDocument document, string action, Guid requestId)
    {
        CommercialAuditWriter.Add(context, account, "finance.fiscal." + action, nameof(FinanceFiscalDocument),
            document.PublicId, FinanceFiscalPolicy.Disclaimer);
        var added = context.ChangeTracker.Entries<AuditEntry>().Last(e => e.State == EntityState.Added).Entity;
        added.CorrelationId = requestId; added.RequestId = requestId.ToString("D"); added.OccurredAt = Now;
    }
    private static bool ValidVersion(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return false;
        Span<byte> bytes = stackalloc byte[8];
        return Convert.TryFromBase64String(value, bytes, out var count) && count == 8;
    }
    private string CreateHash(FiscalCreateInput input, string snapshotHash) => FinanceFiscalPolicy.Hash(JsonSerializer.Serialize(new
    { input.RequestId, input.InvoiceId, input.Outcome, options.Environment, mode = options.Mode.ToString(), snapshotHash }));

    public Task<FiscalResult> CreateAsync(Guid accountId, FiscalCreateInput input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (FinanceFiscalPolicy.ExecutionFailure(options) is { } disabled) return Task.FromResult(Fail(disabled));
        if (input.RequestId == Guid.Empty || input.InvoiceId == Guid.Empty || !Enum.IsDefined(input.Outcome))
            return Task.FromResult(Fail(FinanceFiscalFailure.Invalid));
        return WriteAsync(accountId, async (actor, key) =>
        {
            var scope = await Invoices(actor).SingleOrDefaultAsync(s => s.Invoice.PublicId == input.InvoiceId, cancellationToken);
            if (scope is null) return Fail(FinanceFiscalFailure.NotFound);
            // Serialize creations for the same invoice before testing request and natural keys.
            _ = await context.Set<NonFiscalInvoice>().FromSqlInterpolated(
                $"SELECT * FROM [commercial].[non_fiscal_invoices] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = {scope.Invoice.Id}").SingleAsync(cancellationToken);
            var lines = await context.Set<NonFiscalInvoiceLine>().AsNoTracking().Where(l => l.InvoiceId == scope.Invoice.Id)
                .OrderBy(l => l.LineNumber).ToArrayAsync(cancellationToken);
            // Only the issued snapshot can satisfy preflight. Current policies or commercial profiles never repair history.
            if (!FinanceTaxSnapshotWriter.HasConfiguredIssuedTreatments(scope.Invoice, lines))
                return Fail(FinanceFiscalFailure.Invalid);
            var prior = await context.Set<FinanceFiscalDocument>().SingleOrDefaultAsync(d =>
                d.Environment == options.Environment && d.RequestId == input.RequestId, cancellationToken);
            if (prior is not null)
                return prior.InvoiceId == scope.Invoice.Id && prior.CreatedByAccountId == key && prior.Mode == options.Mode &&
                    prior.RequestHash == CreateHash(input, prior.SnapshotHash) ? Success(prior, true) : Fail(FinanceFiscalFailure.Conflict);
            if (await context.Set<FinanceFiscalDocument>().AnyAsync(d => d.InvoiceId == scope.Invoice.Id &&
                d.Environment == options.Environment && d.Mode == options.Mode, cancellationToken)) return Fail(FinanceFiscalFailure.Conflict);
            string snapshot;
            try
            {
                snapshot = FinanceFiscalPolicy.Snapshot(scope.Invoice.PublicId, scope.Invoice.Number,
                    scope.Invoice.CurrencyCode, scope.Invoice.Total, lines.Select(l => new FiscalSnapshotLine(l.LineNumber,
                        l.Kind.ToString(), l.ParentLineNumber, l.Reason, l.OperationCode, l.OperationDate, l.ServiceCode,
                        l.ServiceName, l.ExecutedQuantity, l.BillingUnit, l.UnitPrice, l.CurrencyCode, l.Amount,
                        l.NetAmount, l.DiscountAmount, l.TaxAmount, l.GrossAmount, l.TaxTreatment.ToString(),
                        l.TaxRate, l.TaxBasis, l.TaxPolicyPublicId, l.TaxCapturedAt)).ToArray(),
                    scope.Invoice.CommercialSnapshotJson, scope.Invoice.NetTotal, scope.Invoice.DiscountTotal, scope.Invoice.TaxTotal);
            }
            catch (ArgumentException) { return Fail(FinanceFiscalFailure.Invalid); }
            var snapshotHash = FinanceFiscalPolicy.Hash(snapshot);
            var document = FinanceFiscalDocument.Create(scope.Invoice.Id, key, input.RequestId, CreateHash(input, snapshotHash),
                options.Mode, options.Environment, input.Outcome, snapshot, snapshotHash, scope.Invoice.CurrencyCode, scope.Invoice.Total, Now);
            context.Add(document); await context.SaveChangesAsync(cancellationToken);
            context.Add(new FinanceFiscalIntent { PublicId = Guid.CreateVersion7(), DocumentId = document.Id,
                Status = FiscalIntentStatus.AwaitingArchive, CreatedAt = Now, UpdatedAt = Now });
            Event(document, "Created", "Canonical snapshot frozen; dispatch intent persisted.");
            Audit(key, document, "created", input.RequestId);
            await context.SaveChangesAsync(cancellationToken);
            return Success(document);
        }, cancellationToken);
    }

    public async Task<IReadOnlyList<FiscalDocumentData>?> ListAsync(Guid accountId, Guid? stationId, int take,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(accountId, ["finance.fiscal.read"], cancellationToken);
        if (actor is null) return null;
        var query = Documents(actor).AsNoTracking();
        if (stationId is { } station)
            query = query.Where(d => Invoices(actor).Any(i => i.Invoice.Id == d.InvoiceId && i.StationId == station));
        var documents = await query.OrderByDescending(d => d.CreatedAt).ThenByDescending(d => d.Id)
            .Take(Math.Clamp(take, 1, 100)).ToArrayAsync(cancellationToken);
        var result = new List<FiscalDocumentData>();
        foreach (var document in documents) result.Add(await DataAsync(actor, document, cancellationToken));
        return result;
    }
    public async Task<FiscalDocumentData?> GetAsync(Guid accountId, Guid documentId, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(accountId, ["finance.fiscal.read"], cancellationToken);
        if (actor is null) return null;
        var document = await Documents(actor).AsNoTracking().SingleOrDefaultAsync(d => d.PublicId == documentId, cancellationToken);
        return document is null ? null : await DataAsync(actor, document, cancellationToken);
    }
    private async Task<FiscalDocumentData> DataAsync(ActorContext actor, FinanceFiscalDocument document, CancellationToken ct)
    {
        var invoice = await Invoices(actor).AsNoTracking().SingleAsync(i => i.Invoice.Id == document.InvoiceId, ct);
        var artifacts = await context.Set<FinanceFiscalArtifact>().AsNoTracking().Where(a => a.DocumentId == document.Id)
            .OrderBy(a => a.Id).Select(a => new FiscalArtifactData(a.PublicId, a.Kind.ToString(), a.FileName,
                a.ContentType, a.Sha256, a.Length)).ToArrayAsync(ct);
        var events = await context.Set<FinanceFiscalEvent>().AsNoTracking().Where(e => e.DocumentId == document.Id)
            .OrderBy(e => e.Id).Select(e => new FiscalEventData(e.EventId, e.Kind, e.State.ToString(), e.ProviderSequence,
                e.Applied, e.Detail, e.CreatedAt)).ToArrayAsync(ct);
        return new(document.PublicId, invoice.Invoice.PublicId, invoice.StationId, document.Mode.ToString(), document.Environment,
            document.State.ToString(), document.ArtifactCompletion.ToString(), document.SnapshotHash, document.CanonicalSnapshot,
            document.Total, document.CurrencyCode, document.ProviderDocumentId, document.DgiiResponseId, document.Encf,
            Version(document), document.CreatedAt, artifacts, events);
    }
    public async Task<FiscalDownload?> DownloadAsync(Guid accountId, Guid documentId, Guid artifactId, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(accountId, ["finance.fiscal.read"], cancellationToken);
        if (actor is null) return null;
        var artifact = await (from a in context.Set<FinanceFiscalArtifact>().AsNoTracking()
            join d in Documents(actor).AsNoTracking() on a.DocumentId equals d.Id
            where d.PublicId == documentId && a.PublicId == artifactId select a).SingleOrDefaultAsync(cancellationToken);
        if (artifact is null) return null;
        try
        {
            var bytes = await archive.GetAsync(artifact.ObjectKey, cancellationToken);
            if (bytes is null || bytes.LongLength != artifact.Length || FinanceFiscalPolicy.Hash(bytes) != artifact.Sha256) return null;
            return new(bytes, artifact.FileName, artifact.ContentType, artifact.Sha256);
        }
        catch (Exception e) when (ArchiveFailure(e)) { return null; }
    }
    private static bool ArchiveFailure(Exception e) => e is not OperationCanceledException || e is TaskCanceledException;
}
